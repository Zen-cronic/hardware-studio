"""Geometry/process comparisons against explicit editable example shop profiles."""
from __future__ import annotations
import math
from .common import StudyError, number, prepare_geometry

# These are disclosed example machine/settings inputs, not universal material limits.
PROFILES = {
    "fdm": {"name":"Example 0.4 mm-nozzle FDM setup", "minWallMm":1.2, "minHoleMm":2.0, "buildEnvelopeMm":[220,220,250], "nozzleDiameterMm":.4, "layerHeightMm":.2},
    "cnc": {"name":"Example three-axis mill with 3 mm end mill", "minWallMm":1.0, "minHoleMm":3.0, "maxHoleAspect":5.0, "toolDiameterMm":3.0, "toolReachMm":40.0, "buildEnvelopeMm":[300,200,100]},
    "turning": {"name":"Example small lathe setup", "minWallMm":1.0, "minHoleMm":2.0, "maxHoleAspect":5.0, "toolReachMm":40.0, "buildEnvelopeMm":[100,300,100]},
}
PROFILE_GUIDANCE = {"fdm":"https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135", "cnc":"https://www.protolabs.com/resources/design-for-machining-toolkit/", "turning":"https://www.protolabs.com/services/cnc-machining/cnc-turning/"}


def manufacturing(request,directory):
    geometry = prepare_geometry(request,directory)
    kind = request.get("profile","fdm")
    if kind not in PROFILES:
        raise StudyError("Choose fdm, cnc or turning process profile")
    profile = dict(PROFILES[kind])
    overrides = request.get("processProfile",{})
    if not isinstance(overrides,dict) or set(overrides)-set(profile):
        raise StudyError("processProfile contains unsupported settings")
    profile.update(overrides)
    for key,value in profile.items():
        if key == "name":
            if not isinstance(value,str) or len(value)>160:
                raise StudyError("Profile name must be a short string")
        elif key == "buildEnvelopeMm":
            if not isinstance(value,list) or len(value)!=3:
                raise StudyError("Build envelope must have three dimensions")
            profile[key]=[number(v,"Build envelope",.1,100000) for v in value]
        else:
            profile[key]=number(value,key,.001,100000)
    findings=[]
    def add(code,feature,measured,limit,message,severity="warning"):
        findings.append({"code":code,"partId":request.get("partId") or (geometry["part"] or {}).get("id"),"feature":feature,"measuredMm":measured if code!="hole-aspect" else None,"limitMm":limit if code!="hole-aspect" else None,"measured":measured,"limit":limit,"unit":"ratio" if code=="hole-aspect" else "mm","message":message,"severity":severity,"ruleSource":"Explicit process profile", "guidanceUrl":PROFILE_GUIDANCE[kind]})
    size=geometry["bounds"]["size"]
    # Compare current orientation explicitly; a fit after reorientation is a different setup.
    for i,(extent,limit) in enumerate(zip(size,profile["buildEnvelopeMm"])):
        if extent>limit:
            add("envelope",f"axis-{i}",extent,limit,"Part exceeds the selected machine envelope in its current local orientation")
    part=geometry["part"]
    checked=["current-orientation machine envelope"]
    gaps=[]
    minimum=None
    setups=1
    if part:
        x,y,z=part["size"]
        walls=[]
        if part["shape"]=="box":
            walls.append(("body",min(x,y,z)))
            if part.get("channel"):
                c=part["channel"]
                walls.extend([("channel-roof",y-c["depth"]),("channel-sidewall",(z-c["width"])/2)])
                if kind in ("cnc","turning") and c["width"]<profile.get("toolDiameterMm",0):
                    add("channel-tool-access","channel",c["width"],profile["toolDiameterMm"],"Selected cutter cannot enter the channel")
                if kind=="cnc":
                    setups=2
                    add("second-setup","channel",None,None,"Underside channel requires an explicitly planned opposite-side setup","info")
        elif part["shape"]=="tube":
            walls.append(("tube-wall",(z-part["holeDiameter"])/2))
        else:
            walls.append(("body",min(x,y,z)))
        for i,section in enumerate(part.get("sections",[])):
            if section["bore"]:
                walls.append((f"sections/{i}/wall",(section["diameter"]-section["bore"])/2))
        holes=part.get("holes",[])
        for i,hole in enumerate(holes):
            path=f"holes/{i}"
            diameter=hole["diameter"]
            outer=(hole.get("counterbore") or hole)["diameter"]
            if part["shape"]=="box":
                walls.extend([(path+"/x-edge",x/2-abs(hole["x"])-outer/2),(path+"/z-edge",z/2-abs(hole["z"])-outer/2)])
            else:
                radial=math.hypot(hole["x"],hole["z"])
                walls.append((path+"/outer-edge",x/2-radial-outer/2))
                if part["shape"]=="tube" and not part.get("loopSpan"):
                    walls.append((path+"/bore-edge",radial-outer/2-part["holeDiameter"]/2))
            if diameter<profile["minHoleMm"]:
                add("small-hole",path,diameter,profile["minHoleMm"],"Hole is below the chosen process profile; revise it or specify a suitable tool/finishing operation")
            if kind in ("cnc","turning"):
                if y/diameter>profile["maxHoleAspect"]:
                    add("hole-aspect",path,y/diameter,profile["maxHoleAspect"],"Through-hole depth/diameter exceeds the selected drilling ratio")
                if y>profile["toolReachMm"]:
                    add("drill-reach",path,y,profile["toolReachMm"],"Selected tool reach does not span this through-hole; specify another tool or setup")
            if hole.get("counterbore"):
                walls.append((path+"/counterbore-floor",y-hole["counterbore"]["depth"]))
            for j,other in enumerate(holes[:i]):
                other_outer=(other.get("counterbore") or other)["diameter"]
                walls.append((f"holes/{j}-{i}/web",math.hypot(hole["x"]-other["x"],hole["z"]-other["z"])-(outer+other_outer)/2))
        minimum=min((value for _,value in walls),default=None)
        for feature,value in walls:
            if value<profile["minWallMm"]:
                add("thin-wall",feature,value,profile["minWallMm"],"Local wall or web is below the selected process profile")
        checked.extend(["recognized wall/web dimensions","through-hole dimensions","counterbore floors","machine/tool envelope"])
        if kind=="turning" and (part["shape"]=="box" or part.get("holes") or part.get("channel") or part.get("loopSpan")):
            add("non-axisymmetric","body",None,None,"This geometry requires milling/secondary operations; a turning-only setup is insufficient")
        if kind=="fdm":
            gaps.extend(["Overhang/support generation and slicer toolpaths are not computed","Printed anisotropy, shrinkage, infill and fit require print-profile verification"])
    else:
        gaps.append("Imported freeform wall thickness, cutter accessibility and hole recognition require feature reconstruction; only envelope is checked")
    gaps.extend(["Workholding, CAM/toolpaths, surface finish and actual machine capability require review","Supplier dimensions and assembly tolerances are not inferred"])
    return {"status":"solved","type":"manufacturing","profile":profile,"profileKind":kind,"profileProvenance":"Editable example process inputs; numerical limits are not universal manufacturer requirements", "guidanceUrl":PROFILE_GUIDANCE[kind],"findings":findings,"checksPerformed":checked,"unassessed":gaps,"minimumRecognizedWallMm":minimum,"minimumSetupCount":setups,"geometry":{k:v for k,v in geometry.items() if k not in ("path","part")},"units":{"length":"mm"},"assumptions":["Checks compare the current geometry to the displayed process profile.","No production-ready certification or universal pass/fail is assigned."]}
