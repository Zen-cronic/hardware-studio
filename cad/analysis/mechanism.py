"""Explicit-input rigid-body and quasi-static calculations; not a dynamics engine."""
from __future__ import annotations
import math
import numpy as np
from .common import StudyError, number, vec, prepare_geometry


def mechanism(request,directory):
    geometry=prepare_geometry(request,directory)
    spec=request.get("mechanism")
    if not isinstance(spec,dict):
        raise StudyError("Supply a mechanism with kind arm, rotary, linear or hydrostatic")
    material=request.get("material",{})
    density=number(material.get("densityKgM3"),"Material density kg/m3",.01,1e6)
    mass=geometry["volumeMm3"]*1e-9*density
    kind=spec.get("kind")
    result={"status":"solved","type":"mechanism","kind":kind,"massKg":mass,"inputs":spec,"findings":[],"units":{"length":"mm","force":"N","torque":"N m","mass":"kg"},"assumptions":["Explicit-input rigid-body/quasi-static calculation, not a flexible-body or contact simulation.","Drive efficiency/friction and holding capability must be supplied; component ratings are not inferred."]}
    if kind=="arm":
        payload=number(spec.get("payloadKg"),"Payload kg",0,10000)
        reach=number(spec.get("reachMm"),"Pivot-to-payload reach mm",.01,10000)
        angle=number(spec.get("angleDeg",0),"Angle from horizontal degrees",-360,360)
        lever=reach/1000*abs(math.cos(math.radians(angle)))
        # Payload torque is exact for stated geometry; own-weight torque needs a defined COM lever.
        torque=payload*9.80665*lever
        result.update(payloadTorqueNm=torque,requiredHoldingTorqueNm=torque,horizontalReachMm=lever*1000,payloadForceN=payload*9.80665)
        if "centerOfMassReachMm" in spec:
            self_reach=number(spec["centerOfMassReachMm"],"Center of mass lever mm",0,10000)/1000
            torque+=mass*9.80665*self_reach*abs(math.cos(math.radians(angle)))
            result["requiredHoldingTorqueNm"]=torque
        else:
            result["assumptions"].append("Self-weight joint torque is unassessed until the pivot-to-COM distance is supplied.")
        if "holdingTorqueNm" in spec:
            available=number(spec["holdingTorqueNm"],"Available holding torque Nm",0,1e8)
            result.update(availableHoldingTorqueNm=available,holdingMarginNm=available-torque)
            if available<torque:
                result["findings"].append({"code":"insufficient-holding-torque","message":"Declared joint holding torque is below the calculated requirement"})
        if "jointLimitsDeg" in spec:
            limits=spec["jointLimitsDeg"]
            if not isinstance(limits,list) or len(limits)!=2 or number(limits[0],"Joint lower limit")>number(limits[1],"Joint upper limit"):
                raise StudyError("jointLimitsDeg needs an ordered lower/upper pair")
            result["withinJointLimits"]=limits[0]<=angle<=limits[1]
            if not result["withinJointLimits"]:
                result["findings"].append({"code":"joint-limit","message":"Requested pose exceeds the declared joint limits"})
    elif kind=="rotary":
        axis=spec.get("axis","y")
        if axis not in ("x","y","z"):
            raise StudyError("Rotation axis must be x, y or z")
        if geometry["format"]=="step":
            import cadquery as cq
            shape=cq.importers.importStep(geometry["path"]).val()
            inertia=np.array(cq.Shape.matrixOfInertia(shape))*density*1e-15
            center=np.array(shape.Center().toTuple())
        else:
            import trimesh
            mesh=trimesh.load_mesh(geometry["path"])
            inertia=mesh.moment_inertia*density*1e-15
            center=mesh.center_mass
        index=("x","y","z").index(axis)
        moment=float(inertia[index,index])
        if "pivotLocalMm" in spec:
            delta=(center-vec(spec["pivotLocalMm"],"Pivot"))/1000
            moment+=mass*float(np.dot(delta,delta)-delta[index]**2)
        rpm=number(spec.get("rpm"),"RPM",0,100000)
        seconds=number(spec.get("accelerationSeconds"),"Acceleration time seconds",.001,100000)
        efficiency=number(spec.get("efficiency",1),"Transmission efficiency",.001,1)
        friction=number(spec.get("frictionTorqueNm",0),"Friction torque Nm",0,1e8)
        alpha=rpm*2*math.pi/60/seconds
        torque=(moment*alpha+friction)/efficiency
        result.update(inertiaKgM2=moment,angularAccelerationRadS2=alpha,requiredDriveTorqueNm=torque)
        if "availableTorqueNm" in spec:
            available=number(spec["availableTorqueNm"],"Available motor torque at selected speed Nm",0,1e8)
            result["driveMarginNm"]=available-torque
            if available<torque:
                result["findings"].append({"code":"insufficient-drive-torque","message":"Declared available torque at the selected speed is below acceleration/friction demand"})
        result["assumptions"].append("Inertia is computed from the complete selected solid; unspecified pivot is its center of mass. Defaults efficiency=1 and friction=0 are idealized inputs.")
    elif kind=="linear":
        payload=number(spec.get("payloadKg",0),"Payload kg",0,10000)
        speed=number(spec.get("speedMmS"),"Speed mm/s",.001,1e6)
        travel=number(spec.get("travelMm"),"Travel mm",.001,100000)
        seconds=number(spec.get("accelerationSeconds"),"Acceleration time seconds",.001,100000)
        efficiency=number(spec.get("efficiency",1),"Transmission efficiency",.001,1)
        friction=number(spec.get("frictionForceN",0),"Friction force N",0,1e8)
        acceleration=speed/1000/seconds
        force=((mass+payload)*acceleration+friction)/efficiency
        result.update(accelerationMS2=acceleration,requiredDriveForceN=force,constantSpeedTravelSeconds=travel/speed,accelerationDistanceMm=.5*speed*seconds)
        if .5*speed*seconds*2>travel:
            result["findings"].append({"code":"insufficient-travel","message":"Acceleration and symmetric deceleration distances exceed available travel"})
        if "availableForceN" in spec:
            available=number(spec["availableForceN"],"Available drive force N",0,1e8)
            result["driveMarginN"]=available-force
            if available<force:
                result["findings"].append({"code":"insufficient-drive-force","message":"Declared available drive force is below acceleration/friction demand"})
    elif kind=="hydrostatic":
        depth=number(spec.get("liquidDepthMm"),"Liquid depth mm",0,10000)/1000
        liquid_density=number(spec.get("liquidDensityKgM3"),"Liquid density kg/m3",.01,100000)
        width=number(spec.get("wallWidthMm"),"Vertical wall width mm",.001,100000)/1000
        result.update(bottomPressurePa=liquid_density*9.80665*depth,verticalWallResultantN=.5*liquid_density*9.80665*width*depth**2,resultantHeightAboveBottomMm=depth*1000/3)
        result["assumptions"].append("Static liquid, vertical rectangular wall, free surface at zero gauge pressure; no sloshing or fluid/structure coupling.")
    else:
        raise StudyError("Mechanism kind must be arm, rotary, linear or hydrostatic","unsupported_physics")
    return result
