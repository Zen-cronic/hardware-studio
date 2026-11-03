"""Continuous-loop topology and supplier-envelope interfaces; no belt performance claim."""
import math
import cadquery as cq
import pytest
from cad.geometry import local_shape, bounds, DesignError, world_shape
from cad.documents import drawing_svg
BELT={"id":"belt","name":"Continuous belt clearance envelope","shape":"tube","size":[701.59,6,21.59],"loopSpan":680,"holeDiameter":18.59,"position":[0,55.5,0],"color":"#353841","material":"Rubber","process":"buy"}

@pytest.mark.parametrize("span",[.5,100,680,2000])
def test_loop_exact_volume_and_reopened_step(span,tmp_path):
    p={**BELT,"loopSpan":span,"size":[span+21.59,6,21.59]}
    shape=local_shape(p)
    expected=(span*3+math.pi*(21.59**2-18.59**2)/4)*6
    assert shape.Volume()==pytest.approx(expected,rel=1e-8)
    dest=tmp_path/'belt.step'; cq.exporters.export(shape,str(dest))
    reopened=cq.importers.importStep(str(dest)).val()
    assert reopened.isValid() and len(reopened.Solids())==1
    assert reopened.Volume()==pytest.approx(expected,rel=1e-8)
    assert bounds(reopened)['size']==pytest.approx(p['size'],abs=1e-6)
    svg=drawing_svg(p,1)
    assert f"Loop centres: {span:g} along X" in svg
    assert "Tooth profile, pitch line and tension are not modeled" in svg
    assert "Ø 701.59" not in svg  # overall length is not a diameter

def test_loop_has_two_runs_and_seats_on_equal_pulley_envelopes():
    shape=world_shape(BELT)
    for x in (-340,340):
        pulley=cq.Solid.makeCylinder(18.59/2,7,cq.Vector(x,52,0),cq.Vector(0,1,0))
        assert shape.intersect(pulley).Volume()<1e-6
        assert shape.distance(pulley)<1e-6
        oversize=cq.Solid.makeCylinder(20/2,7,cq.Vector(x,52,0),cq.Vector(0,1,0))
        assert shape.intersect(oversize).Volume()>10
    # Cross-sections through the straight portion see both separated return/drive runs.
    cut=shape.intersect(cq.Workplane('XY').box(1,8,40).translate((0,55.5,0)).val())
    assert len(cut.Solids())==2
    assert cut.Volume()==pytest.approx(18,abs=1e-6)
    void=cq.Workplane('XY').box(600,8,18).translate((0,55.5,0)).val()
    assert shape.intersect(void).Volume()<1e-6

@pytest.mark.parametrize('change',[
 {'loopSpan':0},{'loopSpan':None},{'loopSpan':float('nan')},{'loopSpan':float('inf')},{'loopSpan':679},
 {'shape':'box'},{'shape':'cylinder'},{'holeDiameter':21.59},{'holeDiameter':21.1},{'holeDiameter':0},
 {'sections':[]},{'holes':[]},{'channel':{'width':2,'depth':2}},
])
def test_reject_invalid_loop_contract(change):
    with pytest.raises(DesignError): local_shape({**BELT,**change})
