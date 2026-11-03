"""Human-readable build information, derived from the accepted revision."""
from __future__ import annotations

import csv
import html
import io
import json
from pathlib import Path


def header(snapshot: dict) -> str:
    d = snapshot["design"]
    return f"# {d['name']}\n\nDesign: {d['id']} · Revision: {d['revision']} · dimensions in millimetres\n\n"


def csv_cell(value: object) -> str:
    text = str(value if value is not None else "")
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


def bom_csv(snapshot: dict) -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(["design_id", "revision", "part_id", "name", "quantity", "material", "process", "specification", "source_url"])
    for row in snapshot["derived"]["bom"]:
        writer.writerow([csv_cell(v) for v in [snapshot["design"]["id"], snapshot["design"]["revision"], row.get("id"), row.get("name"), row.get("quantity"), row.get("material"), row.get("process"), row.get("specification"), row.get("sourceUrl", "")]])
    return out.getvalue()


def assembly_md(snapshot: dict) -> str:
    text = header(snapshot) + "## Assembly sequence\n\n"
    for i, step in enumerate(snapshot["derived"]["steps"], 1):
        text += f"### {i}. {step['title']}\n\n{step['instruction']}\n\nParts: " + ", ".join(step["partIds"]) + f".\n\nCheck: {step['check']}\n\n"
    text += "## Review before making\n\n"
    text += "Confirm purchased-part dimensions and supplier drawings against the model. Check the selected process, fits, fasteners, tolerances and tools before fabrication. CAD solids describe the nominal geometry; they do not certify strength, electrical safety or a manufactured fit.\n"
    for warning in snapshot["derived"]["warnings"]:
        text += f"\n- {warning}"
    return text + "\n"


def param_table(snapshot: dict) -> str:
    return "\n".join(f"| {key} | {value:g} |" for key, value in snapshot["design"]["params"].items())


def wiring_md(snapshot: dict) -> str:
    kind = snapshot["design"]["kind"]
    p = snapshot["design"]["params"]
    text = header(snapshot) + "## Control and connections\n\n"
    text += "This document specifies behavior and connection intent. Select exact low-voltage components, supply, protection and wire sizes from their datasheets before wiring. GPIO pin numbers, mains wiring, driver current and machine-specific firmware are intentionally not inferred.\n\n"
    controls = {
        "turntable": f"Use a regulated low-voltage supply and suitable motor driver. Controller → driver STEP/DIR or speed input → motor; common signal reference where required. Set the speed to {p.get('rpm', 6):g} rpm. For a stepper, pulse rate = rpm × motor steps/revolution × microsteps × gear ratio / 60. Confirm each factor from selected hardware. On stop, command zero speed, disable the drive if appropriate, and keep the stop function accessible.",
        "slider": f"Controller → motor driver → belt drive; endpoint sensors → controller inputs with defined pull-ups. Requested travel is {p.get('travel', 400):g} mm at {p.get('speed', 30):g} mm/s. Home at reduced speed, stop on endpoint, then constrain every move to [0, travel]. Calibrate steps/mm from belt pitch and pulley tooth count. Use acceleration ramps and cable slack checks.",
        "conveyor": f"Presence sensor → controller input; controller → conveyor drive and diverter output. Nominal belt speed is {p.get('speed', 40):g} mm/s, sensor position {p.get('sensorPosition', 180):g} mm from the inlet, conveyor length {p.get('length', 500):g} mm. Arrival delay = measured sensor-to-diverter distance / measured belt speed. Debounce detection, record the detected item, wait the calibrated delay, actuate, then return the diverter. On a jam or lost sensor, stop the drive rather than continue open-loop.",
        "lamp": f"Regulated low-voltage supply → rated constant-current LED driver → LED module. Controller dimming output → driver DIM input only if supported. Brightness request is {p.get('brightness', 70):g} percent. Confirm LED current, driver thermal limits and heatsink. Route insulated cable with slack at moving joints and strain relief at each termination. Do not route motor current or LED power directly through a GPIO.",
        "planter": f"Controller → rated pump switch/driver → low-voltage pump; reservoir level switch → controller input. Requested watering duration is {p.get('waterMinutes', 2):g} min for {p.get('pots', 3):g} pots. Confirm flow by collecting and measuring water, then set the schedule from plant needs. Stop immediately on low reservoir, excessive runtime or leak detection. Separate wet tubing from electronics; protect the pump driver as its datasheet requires.",
        "holder": "This is a manual mechanism with no electrical circuit. The clamp screw converts rotation to jaw movement. Verify screw pitch, travel stops, jaw retention and workpiece contact before use. Do not infer holding capacity from the visual model.",
        "custom": "No electrical circuit is inferred for custom primitives. Add a reviewed wiring schematic, device ratings and control requirements if the design uses powered components.",
    }
    if kind == "turntable" and snapshot["design"].get("mechanismVersion") == 2:
        controls[kind] = f"Pololu 4756 is a 12 V brushed DC gearmotor with quadrature encoder, not a stepper. Use a separately selected, current-limited H-bridge and protected supply; encoder A/B signals feed a compatible controller. The manufacturer specifies 8400 counts per output revolution with its stated counting convention. Requested {p['rpm']:g} rpm is a visualization/control target only. Verify encoder supply and logic voltage, counting convention, driver sizing, startup/stall response, fuse and stop behavior from datasheets and bench tests. No working controller or achieved speed is supplied."
    text += controls[kind] + "\n\n## Accepted behavior parameters\n\n| Parameter | Value |\n|---|---:|\n" + param_table(snapshot) + "\n\n## Connection map\n\n"
    for connection in snapshot["derived"]["connections"]:
        text += f"- {connection['from']} → {connection['to']}: {connection['description']}\n"
    text += "\nControl logic is a review specification, not flashable firmware or a safety-rated controller program.\n"
    return text


def process_md(snapshot: dict) -> str:
    text = header(snapshot) + "## Fabrication preparation\n\n"
    text += "STEP files preserve exact nominal solids. STL coordinates are millimetres; STL does not carry a unit declaration. Drawings use local part axes; assembly.step uses the browser's Y-up assembly coordinates. Individual parts are centered at the origin for setup, while the assembly records their placement.\n\n"
    processes = {part["process"] for part in snapshot["derived"]["parts"]}
    if "print" in processes:
        text += "### 3D printing\n\nChoose a material suitable for temperature, creep and loading. Orient load-bearing layers deliberately, inspect overhangs and add supports in the slicer. Print a fit coupon for holes and mating surfaces before the whole part. Wall thickness, infill, shrink compensation and slicer settings require review for the selected printer. Exported nominal fits do not include an automatic printer calibration allowance.\n\n"
    if "machine" in processes:
        text += "### Machining / CNC / lathe\n\nChoose stock, datums, workholding and tools from the actual machine. Cylindrical parts can use a turning setup where accessible; bores need a measured fit specification. Review internal corner/tool clearance and setup changes. Generate CAM and simulate toolpaths in the selected system; this package does not include controller-specific G-code. Deburr and inspect mating dimensions before assembly.\n\n"
    if "cut" in processes:
        text += "### Cut stock\n\nConfirm supplier section dimensions and allowance for kerf, end finishing and clamping. Mark lengths from the drawings, cut, deburr, and verify overall length and squareness. Do not treat a nominal rectangular representation as a supplier's exact extrusion profile.\n\n"
    if "buy" in processes:
        text += "### Purchased parts\n\nTreat simplified purchased-part geometry as an envelope. Match interfaces, ratings and supplier drawings before ordering. Sources in the BOM are research starting points; no stock, quote, delivery date or fit is asserted.\n\n"
    text += "## Part setup list\n\n| Part | Process | Material | Local dimensions (mm) |\n|---|---|---|---|\n"
    for part in snapshot["derived"]["parts"]:
        text += f"| {part['name']} | {part['process']} | {part['material']} | " + " × ".join(f"{v:g}" for v in part["size"]) + " |\n"
    text += "\n## Quality checks\n\nMeasure critical interfaces, dry-fit before powered operation, verify clearances through the entire motion range, and inspect fasteners and cable/tube routing. Bench testing and process review remain necessary; geometry validation alone does not establish load capacity or electrical suitability.\n"
    return text


def quote_md(snapshot: dict) -> str:
    text = header(snapshot) + "## Fabrication quote request\n\n"
    text += "Please review the attached STEP/STL, dimensioned drawings, BOM and assembly instructions. Confirm manufacturability and identify missing tolerances or specifications before quoting.\n\n"
    text += "- Quantity: [enter requested quantity]\n- Delivery location / date: [enter requirements]\n- Critical fits / tolerance class: [confirm with fabricator]\n- Surface finish and appearance: [enter requirements]\n- Substitutions: [list allowed alternatives]\n- Inspection report: [enter requested measurements]\n\n"
    text += "Request separate prices for material, setup, fabrication, finishing, assembly and delivery. Ask which assumptions affect price. This file has not been sent to any supplier.\n\n## Supplier research links\n\n"
    links = sorted({row.get("sourceUrl", "") for row in snapshot["derived"]["bom"] if str(row.get("sourceUrl", "")).startswith("https://")})
    text += "\n".join(f"- {url}" for url in links) or "No supplier link has been selected for this revision."
    return text + "\n"


def drawing_svg(part: dict, revision: int) -> str:
    """Dimensioned local orthographic views of the supported analytic primitives."""
    esc = html.escape
    x, y, z = part["size"]
    scale = min(270 / x, 240 / y, 240 / z)
    # Front is XY; top is XZ. Cylinders use their analytic silhouettes.
    front_width, front_height = x * scale, y * scale
    side_width, side_height = z * scale, y * scale
    front_x, front_y = 210 - front_width / 2, 240 - front_height / 2
    side_x, side_y = 580 - side_width / 2, 240 - side_height / 2
    top_r = x * scale / 2
    front = f'<rect x="{front_x}" y="{front_y}" width="{front_width}" height="{front_height}"/>'
    side = f'<rect x="{side_x}" y="{side_y}" width="{side_width}" height="{side_height}"/>'
    top = f'<rect x="{210-x*scale/2}" y="{580-z*scale/2}" width="{x*scale}" height="{z*scale}"/>' if part["shape"] == "box" else f'<circle cx="210" cy="580" r="{top_r}"/>'
    if part["shape"] == "tube":
        top += f'<circle cx="210" cy="580" r="{part["holeDiameter"]*scale/2}"/>'
        for cx in (210, 580):
            inner = part["holeDiameter"] * scale / 2
            front += f'<path stroke-dasharray="6 4" d="M {cx-inner} {front_y} v {front_height} M {cx+inner} {front_y} v {front_height}"/>'
    details = []
    if part.get("sections"):
        front = side = ""
        offset = 0
        top = ""
        for section_index,q in enumerate(part["sections"]):
            w=q["diameter"]*scale; sh=q["height"]*scale; sy=240+y*scale/2-(offset+q["height"])*scale
            for cx, target in ((210,"front"),(580,"side")):
                rect=f'<rect x="{cx-w/2}" y="{sy}" width="{w}" height="{sh}"/>'
                if q["bore"]:
                    inner=q["bore"]*scale/2
                    rect+=f'<path stroke-dasharray="6 4" d="M {cx-inner} {sy} v {sh} M {cx+inner} {sy} v {sh}"/>'
                if target=="front": front+=rect
                else: side+=rect
            hidden = ' stroke-dasharray="6 4"' if section_index < len(part["sections"])-1 else ""
            top+=f'<circle cx="210" cy="580" r="{w/2}"{hidden}/>'
            if q["bore"]: top+=f'<circle cx="210" cy="580" r="{q["bore"]*scale/2}"{hidden}/>'
            details.append(f"Axial Y {offset:g}–{offset+q['height']:g} from bottom: OD {q['diameter']:g}, bore {q['bore']:g} mm")
            offset+=q["height"]
    if part.get("channel"):
        c=part["channel"]; cw=c["width"]*scale; ch=c["depth"]*scale
        side=f'<path d="M {side_x} {side_y} h {side_width} v {side_height} H {580+cw/2} v {-ch} H {580-cw/2} v {ch} H {side_x} Z"/>'
        top+=f'<path stroke-dasharray="6 4" d="M {front_x} {580-cw/2} h {front_width} M {front_x} {580+cw/2} h {front_width}"/>'
        front+=f'<path stroke-dasharray="6 4" d="M {front_x} {front_y+front_height-ch} h {front_width}"/>'
        details.append(f"Underside channel: {c['width']:g} wide along Z × {c['depth']:g} deep from −Y; full X length")
    for i,q in enumerate(part.get("holes",[]),1):
        top+=f'<circle cx="{210+q["x"]*scale}" cy="{580-q["z"]*scale}" r="{q["diameter"]*scale/2}"/>'
        details.append(f"Hole {i}: X {q['x']:.3f}, Z {q['z']:.3f}, Ø {q['diameter']:g} through material along Y")
        if q.get("counterbore"):
            cb=q["counterbore"]
            top+=f'<circle cx="{210+q["x"]*scale}" cy="{580-q["z"]*scale}" r="{cb["diameter"]*scale/2}"/>'
            details.append(f"Counterbore {i}: Ø {cb['diameter']:g} × {cb['depth']:g} deep from +Y face")
    feature_text="".join(f'<text x="32" y="{800+i*22}" font-size="13">{esc(line)}</text>' for i,line in enumerate(details))
    sheet_height=800+len(details)*22
    diameter = "Ø " if part["shape"] != "box" else ""
    bore = f' · Bore Ø {part["holeDiameter"]:g} through' if part["shape"] == "tube" else ""
    if part.get("sections"): bore = " · stepped profile: see axial table"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="{sheet_height}" viewBox="0 0 1000 {sheet_height}">
<rect width="1000" height="{sheet_height}" fill="white"/>
<style>text{{font-family:Arial,sans-serif;fill:#202124}} .shape{{fill:none;stroke:#202124;stroke-width:1.5}} .dim{{fill:none;stroke:#52565d;stroke-width:1}}</style>
<text x="32" y="40" font-size="24">{esc(part["name"])}</text>
<text x="32" y="68" font-size="14">{esc(part["id"])} · revision {revision} · all dimensions mm · local part axes</text>
<g class="shape">{front}{side}{top}</g>
<text x="160" y="105" font-size="16">FRONT (X–Y)</text><text x="530" y="105" font-size="16">RIGHT (Z–Y)</text>
<text x="160" y="430" font-size="16">TOP (X–Z)</text>
<g class="dim"><path d="M {front_x} {front_y+front_height+12} v 24 M {front_x+front_width} {front_y+front_height+12} v 24 M {front_x} {front_y+front_height+24} h {front_width}"/>
<path d="M {front_x+front_width+12} {front_y} h 24 M {front_x+front_width+12} {front_y+front_height} h 24 M {front_x+front_width+24} {front_y} v {front_height}"/></g>
<text x="210" y="{front_y+front_height+45}" font-size="15" text-anchor="middle">{diameter}{x:g}</text>
<text x="{front_x+front_width+42}" y="245" font-size="15">{y:g}</text>
<text x="580" y="{side_y+side_height+45}" font-size="15" text-anchor="middle">{z:g}</text>
<text x="390" y="470" font-size="16">Material: {esc(part["material"])}</text>
<text x="390" y="500" font-size="16">Process: {esc(part["process"])}</text>
<text x="390" y="530" font-size="16">{x:g} × {y:g} × {z:g} mm{bore}</text>
<text x="390" y="570" font-size="14">Nominal geometry. Confirm fit tolerances and finish.</text>
<text x="390" y="595" font-size="14">Purchased components are envelope models.</text>
<text x="32" y="754" font-size="13">Not to scale when printed. Review process, mating interfaces and required tolerances before fabrication.</text>
{feature_text}
</svg>'''


def write_documents(snapshot: dict, output: Path, file_map: dict[str, str]) -> None:
    (output / "bom.csv").write_text(bom_csv(snapshot))
    (output / "assembly.md").write_text(assembly_md(snapshot))
    (output / "wiring.md").write_text(wiring_md(snapshot))
    (output / "process-notes.md").write_text(process_md(snapshot))
    (output / "quote-request.md").write_text(quote_md(snapshot))
    (output / "drawings").mkdir()
    for part in snapshot["derived"]["parts"]:
        (output / "drawings" / (file_map[part["id"]] + ".svg")).write_text(drawing_svg(part, snapshot["design"]["revision"]))
