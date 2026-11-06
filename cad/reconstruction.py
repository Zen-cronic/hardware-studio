"""Immutable-source import inspector and measured parametric approximation CLI."""
from __future__ import annotations
import argparse,contextlib,hashlib,io,json,math,sys
from pathlib import Path
import numpy as np
import trimesh
from scipy.spatial.transform import Rotation
from scipy.stats import qmc
import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Plane,GeomAbs_Cylinder
from cad.geometry import local_shape,world_shape,validate_part
from cad.analysis.common import StudyError,number,digest


def tessellate(shape,tolerance=.03):
    vertices,faces=shape.tessellate(tolerance,.05)
    return trimesh.Trimesh(vertices=np.array([v.toTuple() for v in vertices]),faces=np.array(faces),process=True)


def inspect_mesh(mesh):
    import open3d as o3d
    if not np.isfinite(mesh.vertices).all() or len(mesh.faces)>300000:
        return 'Non-finite geometry or more than300000 triangles'
    mesh.merge_vertices(digits_vertex=12)
    if not mesh.is_watertight or not mesh.is_winding_consistent or not mesh.is_volume or mesh.volume<=0:
        return 'Open, inconsistently oriented or non-positive-volume mesh; no repair was applied'
    m=o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(mesh.vertices),o3d.utility.Vector3iVector(mesh.faces))
    if not m.is_edge_manifold(allow_boundary_edges=False) or not m.is_vertex_manifold() or not m.is_orientable() or m.is_self_intersecting():
        return 'Nonmanifold or self-intersecting mesh; no repair was applied'
    if len(mesh.split(only_watertight=False))!=1:
        return 'Multiple disconnected physical bodies need separate source objects'
    return None


def preview(mesh):
    vertices,faces=mesh.vertices,mesh.faces
    simplified=False
    if len(faces)>25000:
        import open3d as o3d
        m=o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(vertices),o3d.utility.Vector3iVector(faces)).simplify_quadric_decimation(25000)
        vertices,faces=np.asarray(m.vertices),np.asarray(m.triangles);simplified=True
    return {'vertices':vertices.tolist(),'faces':faces.tolist(),'simplifiedForDisplay':simplified}


def source_bodies(request):
    source=request.get('geometry',{})
    filename=Path(source.get('path',''))
    if not filename.is_file() or filename.stat().st_size>8*1024*1024:
        raise StudyError('Source must be a file no larger than8MB','invalid_geometry')
    kind=source.get('format',filename.suffix.lower().lstrip('.'))
    scale=number(source.get('scaleToMm'),'Scale to millimetres',1e-6,1e6)
    bodies=[]
    if kind in ('step','stp'):
        shape=cq.importers.importStep(str(filename)).val()
        for i,solid in enumerate(shape.Solids()):
            if scale!=1:solid=solid.scale(scale)
            if not solid.isValid() or solid.Volume()<=0:raise StudyError('Invalid STEP solid','invalid_geometry')
            mesh=tessellate(solid)
            bodies.append({'name':f'Solid {i+1}','shape':solid,'mesh':mesh,'transform':np.eye(4).tolist()})
        if not bodies:
            raise StudyError('STEP contains surfaces but no closed solid','invalid_geometry')
    elif kind in ('stl','obj','glb'):
        scene=trimesh.load_scene(io.BytesIO(filename.read_bytes()),file_type=kind,process=False,skip_materials=True)
        for node in scene.graph.nodes_geometry:
            transform,geometry=scene.graph[node]
            mesh=scene.geometry[geometry].copy();mesh.apply_transform(transform);mesh.apply_scale(scale)
            bodies.append({'name':str(node),'shape':None,'mesh':mesh,'transform':np.asarray(transform).tolist()})
    else:raise StudyError('Choose STEP, STL, OBJ or GLB','invalid_geometry')
    if not 1<=len(bodies)<=16:raise StudyError('Select a source containing1–16 separately named bodies','unsupported_geometry')
    for i,b in enumerate(bodies):
        b['index']=i
        # STEP validity belongs to the exact B-rep. Display tessellation can have
        # coincident/near-coplanar triangle artifacts and is not the analysis solid.
        b['validationError']=None if b['shape'] is not None else inspect_mesh(b['mesh'])
        if len(b['mesh'].faces)>300000:b['validationError']='More than 300000 display triangles; split the source or simplify an explicit copy'
        if np.max(np.abs(b['mesh'].bounds))>100000 or np.max(b['mesh'].extents)>10000:
            b['validationError']='Geometry exceeds the10000mm component envelope; confirm units'
    return bodies,hashlib.sha256(filename.read_bytes()).hexdigest()


def unit(v):
    v=np.asarray(v,dtype=float);return v/np.linalg.norm(v)


def canonical(v):
    v=unit(v)
    return v if v[np.argmax(np.abs(v))]>=0 else -v


def step_features(shape):
    planes=[];cylinders=[]
    for face in shape.Faces():
        surface=BRepAdaptor_Surface(face.wrapped)
        if surface.GetType()==GeomAbs_Plane:
            planes.append((np.array(face.normalAt().toTuple()),face.Area()))
        elif surface.GetType()==GeomAbs_Cylinder:
            cylinder=surface.Cylinder();axis=np.array(cylinder.Axis().Direction().Coord());location=np.array(cylinder.Location().Coord())
            points=np.array([v.Center().toTuple() for v in face.Vertices()])
            # Full cylinder faces can have only two seam vertices. Sample parametric bounds as well.
            u=(surface.FirstUParameter()+surface.LastUParameter())/2;v=(surface.FirstVParameter()+surface.LastVParameter())/2
            point=np.array(surface.Value(u,v).Coord());normal=np.array(face.normalAt(cq.Vector(*point)).toTuple())
            radial=point-location-np.dot(point-location,axis)*axis
            cylinders.append({'axis':canonical(axis),'center':location,'radius':cylinder.Radius(),'points':points,'inner':np.dot(normal,radial)<0,'coverage':abs(surface.LastUParameter()-surface.FirstUParameter())})
        else:
            raise StudyError('Freeform, filleted or non-planar/non-cylindrical STEP detail is outside editable recognition','unsupported_geometry')
    return planes,cylinders


def coordinate_frame(mesh,planes,cylinders):
    if cylinders:
        y=cylinders[0]['axis']
        if any(abs(np.dot(y,c['axis']))<.99999 for c in cylinders):
            raise StudyError('Mixed-axis cylindrical features remain source-view/analysis-only','unsupported_geometry')
    else:
        if not planes:raise StudyError('No stable planar frame was found','unsupported_geometry')
        y=canonical(max(planes,key=lambda p:p[1])[0])
    perpendicular=[(n,a) for n,a in planes if abs(np.dot(n,y))<1e-5]
    if perpendicular:x=canonical(max(perpendicular,key=lambda p:p[1])[0])
    else:
        helper=np.array([1.,0,0]) if abs(y[0])<.8 else np.array([0.,0,1.])
        x=unit(helper-np.dot(helper,y)*y)
    z=unit(np.cross(x,y));x=unit(np.cross(y,z))
    matrix=np.column_stack([x,y,z])
    # For a box, use the longer of the two in-plane axes as local X.
    ext=np.ptp(mesh.vertices@matrix,axis=0)
    if not any(not c['inner'] for c in cylinders) and ext[2]>ext[0]:
        matrix=np.column_stack([z,y,-x])
    return matrix


def mesh_features(mesh,tolerance):
    planes=[(n,float(a)) for n,a in zip(mesh.facets_normal,mesh.facets_area)]
    if not planes:raise StudyError('Mesh has no recognizable planar patches','unsupported_geometry')
    caps=[(mesh.facets_normal[i],float(mesh.facets_area[i])) for i,indices in enumerate(mesh.facets) if len(indices)>2]
    y=canonical(max(caps or planes,key=lambda p:p[1])[0])
    keep=np.abs(mesh.face_normals@y)<.01
    adjacent=mesh.face_adjacency
    smooth=np.einsum('ij,ij->i',mesh.face_normals[adjacent[:,0]],mesh.face_normals[adjacent[:,1]])>math.cos(math.radians(26))
    edges=adjacent[keep[adjacent[:,0]]&keep[adjacent[:,1]]&smooth]
    components=trimesh.graph.connected_components(edges,nodes=np.arange(len(mesh.faces)),min_len=2)
    helper=np.array([1.,0,0]) if abs(y[0])<.8 else np.array([0.,0,1.]);x=unit(helper-np.dot(helper,y)*y);z=unit(np.cross(x,y));frame=np.column_stack([x,y,z])
    cylinders=[]
    for group in components:
        if not np.all(keep[group]):continue
        points=mesh.vertices[np.unique(mesh.faces[group])]
        projected=points@frame;xy=projected[:,[0,2]]
        matrix=np.column_stack([2*xy,np.ones(len(xy))]);target=np.sum(xy*xy,axis=1)
        if np.linalg.matrix_rank(matrix)<3:continue
        solution=np.linalg.lstsq(matrix,target,rcond=None)[0];center=solution[:2]
        radius_sq=solution[2]+np.dot(center,center)
        if radius_sq<=0:continue
        radius=math.sqrt(radius_sq)
        error=float(np.max(np.abs(np.linalg.norm(xy-center,axis=1)-radius)))
        if error>min(tolerance/4,.02):
            raise StudyError('Curved mesh patches are not a measured cylinder','unsupported_geometry')
        angles=np.unique(np.mod(np.arctan2(xy[:,1]-center[1],xy[:,0]-center[0]),2*math.pi))
        gaps=np.diff(np.r_[angles,angles[0]+2*math.pi]);coverage=2*math.pi-float(gaps.max())
        if coverage<math.radians(300):
            raise StudyError('Partial cylinders/fillets are outside the recognized feature vocabulary','unsupported_geometry')
        world_center=frame@np.array([center[0],0,center[1]])
        radial=mesh.triangles_center[group]-world_center
        radial-=np.outer(radial@y,y)
        inner=float(np.einsum('ij,ij->i',mesh.face_normals[group],radial).mean())<0
        cylinders.append({'axis':y,'center':world_center,'radius':radius,'points':points,'inner':inner,'coverage':2*math.pi,'fitResidualMm':error})
    # Only true outer planar faces matter for the frame; faceted cylinder strips are not box planes.
    return planes,cylinders


def candidate(body,tolerance):
    mesh=body['mesh'];shape=body['shape']
    planes,cylinders=step_features(shape) if shape else mesh_features(mesh,tolerance)
    if any(c['coverage']<2*math.pi-1e-4 for c in cylinders):
        raise StudyError('Partial cylindrical surfaces/fillets cannot be silently replaced','unsupported_geometry')
    frame=coordinate_frame(mesh,planes,cylinders)
    def local_features(matrix):
        local=mesh.vertices@matrix;minimum=local.min(axis=0);maximum=local.max(axis=0)
        cs=[]
        for c in cylinders:
            center=c['center']@matrix;points=c['points']@matrix
            cs.append({**c,'localCenter':center,'low':float(points[:,1].min()),'high':float(points[:,1].max())})
        return minimum,maximum,cs
    minimum,maximum,cs=local_features(frame)
    outer=[c for c in cs if not c['inner']];inner=[c for c in cs if c['inner']]
    # Normalize counterbores to the existing top-face convention when every one agrees.
    grouped=[]
    for c in inner:
        match=next((g for g in grouped if np.linalg.norm(g[0]['localCenter'][[0,2]]-c['localCenter'][[0,2]])<tolerance/4),None)
        if match is None:grouped.append([c])
        else:match.append(c)
    positions=[]
    for group in grouped:
        if len(group)==2:
            largest=max(group,key=lambda c:c['radius'])
            positions.append('top' if abs(largest['high']-maximum[1])<tolerance else 'bottom' if abs(largest['low']-minimum[1])<tolerance else 'internal')
    if positions and set(positions)=={'bottom'}:
        frame[:,1]*=-1;frame[:,2]*=-1
        minimum,maximum,cs=local_features(frame);outer=[c for c in cs if not c['inner']];inner=[c for c in cs if c['inner']]
        grouped=[]
        for c in inner:
            match=next((g for g in grouped if np.linalg.norm(g[0]['localCenter'][[0,2]]-c['localCenter'][[0,2]])<tolerance/4),None)
            if match is None:grouped.append([c])
            else:match.append(c)
    center=(minimum+maximum)/2;size=maximum-minimum
    part={'id':'imported-part','name':'Recognized mechanical part','shape':'box','size':size.tolist(),'position':(frame@center).tolist(),'rotation':Rotation.from_matrix(frame).as_euler('XYZ').tolist(),'color':'#72a6d7','material':'Unspecified','process':'machine'}
    if outer:
        if len(outer)!=1:raise StudyError('Stepped outer shafts/curved external features require a richer feature model','unsupported_geometry')
        c=outer[0]
        if abs(c['low']-minimum[1])>tolerance or abs(c['high']-maximum[1])>tolerance:
            raise StudyError('Outer cylinder does not span the selected body','unsupported_geometry')
        center[[0,2]]=c['localCenter'][[0,2]]
        part.update(shape='cylinder',size=[2*c['radius'],float(size[1]),2*c['radius']],position=(frame@center).tolist())
    elif shape:
        for normal,_ in planes:
            if max(abs(normal@frame))<.99999:
                raise StudyError('Chamfered or oblique plane detail remains source-view/analysis-only','unsupported_geometry')
    holes=[];features=[]
    for index,group in enumerate(grouped):
        if len(group)>2:raise StudyError('Complex internal stepped bores are outside editable recognition','unsupported_geometry')
        smallest=min(group,key=lambda c:c['radius']);largest=max(group,key=lambda c:c['radius'])
        low=min(c['low'] for c in group);high=max(c['high'] for c in group)
        if abs(low-minimum[1])>tolerance or abs(high-maximum[1])>tolerance:
            raise StudyError('Blind or incomplete bores remain source-view/analysis-only','unsupported_geometry')
        local_center=smallest['localCenter']-center
        hole={'x':float(local_center[0]),'z':float(local_center[2]),'diameter':2*smallest['radius']}
        if len(group)==2:
            if part['shape']!='box' or abs(largest['high']-maximum[1])>tolerance:
                raise StudyError('Mixed-side or non-plate counterbores remain source-view/analysis-only','unsupported_geometry')
            hole['counterbore']={'diameter':2*largest['radius'],'depth':largest['high']-largest['low']}
        if outer and np.linalg.norm(local_center[[0,2]])<tolerance/4:
            if len(group)!=1:raise StudyError('Stepped central bore is unsupported','unsupported_geometry')
            part['shape']='tube';part['holeDiameter']=hole['diameter']
            features.append({'id':'central-bore','type':'bore','diameterMm':hole['diameter'],'fitResidualMm':smallest.get('fitResidualMm',0)})
        else:
            holes.append(hole);features.append({'id':f'hole-{len(holes)-1}','type':'counterbore' if 'counterbore' in hole else 'through-hole','diameterMm':hole['diameter'],'counterbore':hole.get('counterbore'),'centerLocalMm':[hole['x'],0,hole['z']],'fitResidualMm':max(c.get('fitResidualMm',0) for c in group)})
    if holes:part['holes']=holes
    validate_part(part)
    features.append({'id':'body','type':part['shape'],'sizeMm':part['size'],'commonAxisWorld':frame[:,1].tolist()})
    return part,features


def ray_scene(mesh):
    import open3d as o3d
    legacy=o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(mesh.vertices),o3d.utility.Vector3iVector(mesh.faces))
    scene=o3d.t.geometry.RaycastingScene();scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(legacy))
    return scene


def sample_surface(mesh):
    rng=np.random.default_rng(813)
    weights=mesh.area_faces/mesh.area
    indices=rng.choice(len(mesh.faces),size=min(3500,max(1000,len(mesh.faces))),p=weights)
    a=rng.random(len(indices));b=rng.random(len(indices));root=np.sqrt(a)
    points=(1-root)[:,None]*mesh.triangles[indices,0]+(root*(1-b))[:,None]*mesh.triangles[indices,1]+(root*b)[:,None]*mesh.triangles[indices,2]
    return np.vstack([mesh.vertices,mesh.triangles_center,points])


def verify(body,part,tolerance):
    import open3d as o3d
    shape=world_shape(part);reconstructed=tessellate(shape,min(.01,tolerance/8));original=body['mesh']
    original_scene=ray_scene(original);candidate_scene=ray_scene(reconstructed)
    def distances(scene,points):return scene.compute_distance(o3d.core.Tensor(points.astype(np.float32))).numpy()
    forward=distances(candidate_scene,sample_surface(original));backward=distances(original_scene,sample_surface(reconstructed))
    if body['shape']:
        intersection=body['shape'].intersect(shape).Volume();union=body['shape'].Volume()+shape.Volume()-intersection
        difference=max(0,body['shape'].Volume()+shape.Volume()-2*intersection)
        ratio=difference/union;volume={'method':'exact B-rep symmetric difference','symmetricDifferenceMm3':difference,'unionMm3':union,'relativeDifference':ratio,'upper95RelativeDifference':ratio}
    else:
        bounds=np.array([np.minimum(original.bounds[0],reconstructed.bounds[0]),np.maximum(original.bounds[1],reconstructed.bounds[1])])
        samples=qmc.Sobol(3,scramble=True,seed=813).random_base2(16)*(bounds[1]-bounds[0])+bounds[0]
        tensor=o3d.core.Tensor(samples.astype(np.float32))
        a=original_scene.compute_occupancy(tensor,nsamples=3).numpy()>.5;b=candidate_scene.compute_occupancy(tensor,nsamples=3).numpy()>.5
        union=int(np.count_nonzero(a|b));different=int(np.count_nonzero(a^b));ratio=different/max(1,union)
        if union==0:raise StudyError('Sampling did not resolve a stable enclosed volume','unsupported_geometry')
        z=1.96;upper=(ratio+z*z/(2*union)+z*math.sqrt(ratio*(1-ratio)/union+z*z/(4*union*union)))/(1+z*z/union)
        volume={'method':'65536-point deterministic Sobol occupancy comparison','samples':65536,'symmetricDifferenceMm3':different/65536*float(np.prod(bounds[1]-bounds[0])),'relativeDifference':ratio,'upper95RelativeDifference':upper,'samplingMarginNote':'Wilson-style margin is heuristic for quasi-random Sobol samples; it is not a rigorous confidence bound.'}
    max_distance=max(float(forward.max()),float(backward.max()))
    result={'toleranceMm':tolerance,'surface':{'method':'bidirectional vertex, face-centroid and seeded surface samples','originalToCandidateMaxMm':float(forward.max()),'candidateToOriginalMaxMm':float(backward.max()),'sampledMaxMm':max_distance,'originalSamples':len(forward),'candidateSamples':len(backward)},'volume':volume,'accepted':max_distance<=tolerance and volume['upper95RelativeDifference']<=.01}
    return result,reconstructed


def run(request):
    source_hash=None;result={}
    try:
        source_path=Path(request.get('geometry',{}).get('path',''))
        if source_path.is_file() and source_path.stat().st_size<=8*1024*1024:source_hash=hashlib.sha256(source_path.read_bytes()).hexdigest()
        bodies,source_hash=source_bodies(request)
        result={'status':'inspected','sourceHash':source_hash,'units':{'length':'mm','volume':'mm3','scaleToMm':request['geometry']['scaleToMm']},'bodyCount':len(bodies),'bodies':[{'index':b['index'],'name':b['name'],'bounds':b['mesh'].bounds.tolist(),'volumeMm3':float(b['shape'].Volume() if b['shape'] is not None else b['mesh'].volume) if not b['validationError'] else None,'transform':b['transform'],'validationError':b['validationError']} for b in bodies]}
        index=request.get('bodyIndex',0)
        if isinstance(index,bool) or not isinstance(index,int) or not 0<=index<len(bodies):raise StudyError('Select a valid body index')
        body=bodies[index];result.update(bodyIndex=index,preview=preview(body['mesh']))
        if request.get('action','inspect')=='inspect':return result
        tolerance=number(request.get('toleranceMm',.1),'Reconstruction tolerance mm',.001,1)
        if body['validationError']:raise StudyError(body['validationError'],'invalid_geometry')
        part,features=candidate(body,tolerance)
        fit,reconstructed=verify(body,part,tolerance)
        result.update(status='reconstructed' if fit['accepted'] else 'analysis_only',fit=fit,features=features,candidate=part if fit['accepted'] else None,candidatePreview=preview(reconstructed),limitations=['Editable parametric approximation of recognized common-axis mechanical features; original feature history is not recovered.','Bidirectional surface maxima are sampled, not an exhaustive mathematical distance bound.','Whole-body fit tolerance is a comparison setting, not manufacturing certification.'])
        if not fit['accepted']:result['error']='Reconstructed geometry exceeds surface or volume tolerance; original remains available for viewing and analysis'
        return result
    except StudyError as error:
        return {**result,'status':'analysis_only' if error.status=='unsupported_geometry' else error.status,'error':str(error),'sourceHash':source_hash}
    except Exception as error:
        print(f'Reconstruction: {type(error).__name__}: {error}',file=sys.stderr)
        return {**result,'status':'analysis_only','error':'Geometry could not be reconstructed within the supported feature vocabulary','sourceHash':source_hash}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);args=parser.parse_args()
    request=json.loads(args.input.read_text())
    with contextlib.redirect_stdout(sys.stderr):result=run(request)
    result['inputHash']=digest({'request':request,'sourceHash':result.get('sourceHash')})
    print(json.dumps(result,separators=(',',':'),allow_nan=False))
    return 0 if result['status'] in ('inspected','reconstructed','analysis_only') else 2

if __name__=='__main__':raise SystemExit(main())
