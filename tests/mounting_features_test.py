"""Independent guide/fastener interface oracles; no physical fit claim."""
import copy
import math
import cadquery as cq
import pytest
from cad.geometry import local_shape, bounds, DesignError
from cad.documents import drawing_svg

BLOCK={"id":"block","name":"Guide block envelope","shape":"box","size":[45.4,10,27],"position":[0,8,0],"channel":{"width":12.2,"depth":5.2},"holes":[{"x":x,"z":z,"diameter":3} for x in (-10,10) for z in (-10,10)],"color":"#C8CDD1","material":"Steel","process":"buy"}
RAIL={**BLOCK,"id":"rail","name":"Rail envelope","size":[1120,8,12],"position":[0,4,0],"holes":[{"x":-550+i*25,"z":0,"diameter":3.5,"counterbore":{"diameter":6,"depth":4.5}} for i in range(45)]}
RAIL.pop("channel")

@pytest.mark.parametrize("part,expected",[(BLOCK,45.4*10*27-45.4*12.2*5.2-4*math.pi*1.5**2*10),(RAIL,1120*8*12-45*math.pi*(1.75**2*8+(3**2-1.75**2)*4.5))])
def test_exact_mounting_features_survive_step_roundtrip(part,expected,tmp_path):
    shape=local_shape(part)
    assert shape.Volume()==pytest.approx(expected,rel=1e-9)
    dest=tmp_path/(part["id"]+".step")
    cq.exporters.export(shape,str(dest))
    reopened=cq.importers.importStep(str(dest)).val()
    assert reopened.isValid() and len(reopened.Solids())==1
    assert reopened.Volume()==pytest.approx(expected,rel=1e-8)
    assert bounds(reopened)["size"]==pytest.approx(part["size"],abs=1e-6)
    svg=drawing_svg(part,1)
    assert ("Underside channel: 12.2" if part is BLOCK else "Counterbore 45: Ø 6 × 4.5") in svg

def test_screw_head_is_recessed_and_block_clears_rail():
    rail=local_shape(RAIL)
    # M3 shank with 5.5 × 3 head, 0.25 radial clearance and 1.5 top recess.
    shank=cq.Solid.makeCylinder(1.5,8,cq.Vector(0,-8.5,0),cq.Vector(0,1,0))
    head=cq.Solid.makeCylinder(2.75,3,cq.Vector(0,-.5,0),cq.Vector(0,1,0))
    assert head.intersect(rail).Volume()<1e-6
    assert shank.intersect(rail).Volume()<1e-6
    assert head.distance(rail)<1e-6
    assert head.translate((0,-1,0)).intersect(rail).Volume()>1  # detects missing recess depth
    block=local_shape(BLOCK).translate((0,8,0))
    short_rail=cq.Workplane("XY").box(60,8,12).translate((0,4,0)).val()
    assert block.intersect(short_rail).Volume()<1e-6
    assert block.distance(short_rail)==pytest.approx(.1,abs=1e-6)
    assert block.translate((0,-1,0)).intersect(short_rail).Volume()>1

@pytest.mark.parametrize("change",[
 {"channel":None}, {"holes":[{"x":10,"z":10,"diameter":3,"counterbore":None}]},
 {"channel":{"width":27,"depth":5}}, {"channel":{"width":12,"depth":10}},
 {"holes":[{"x":0,"z":7,"diameter":3}]},
 {"holes":[{"x":10,"z":10,"diameter":3,"counterbore":{"diameter":8,"depth":4}}]},
 {"holes":[{"x":10,"z":10,"diameter":3,"counterbore":{"diameter":4,"depth":10}}]},
 {"holes":[{"x":10,"z":10,"diameter":3,"counterbore":{"diameter":2,"depth":4}}]},
 {"holes":[{"x":x,"z":10,"diameter":2,"counterbore":{"diameter":4,"depth":4}} for x in (0,3)]},
])
def test_reject_broken_feature_topology(change):
    with pytest.raises(DesignError): local_shape({**copy.deepcopy(BLOCK),**change})

def test_channel_and_counterbore_combine_with_independent_volume():
    p=copy.deepcopy(BLOCK)
    for h in p["holes"]: h["counterbore"]={"diameter":4,"depth":8}
    expected=45.4*10*27-45.4*12.2*5.2-4*math.pi*(1.5**2*10+(2**2-1.5**2)*8)
    assert local_shape(p).Volume()==pytest.approx(expected,rel=1e-9)
