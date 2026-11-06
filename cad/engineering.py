"""Engineering CLI: JSON input/output; no generated code or shell commands accepted."""
from __future__ import annotations
import argparse
import hashlib
import contextlib
import json
from pathlib import Path
import sys
import tempfile
from .analysis.common import StudyError, digest


def run(request):
    if not isinstance(request,dict):
        return {"status":"needs_inputs","error":"Request must be an object"}
    imported_hash = None
    imported_path = (request.get("geometry") or {}).get("path") if isinstance(request.get("geometry", {}), dict) else None
    if isinstance(imported_path, str):
        candidate = Path(imported_path)
        if candidate.is_file() and candidate.stat().st_size <= 50*1024*1024:
            imported_hash = hashlib.sha256(candidate.read_bytes()).hexdigest()
    binding = {"source":request.get("source",{}),"inputHash":digest({"request":request,"importedSourceHash":imported_hash}),"schemaVersion":1}
    if imported_hash:
        binding["importedSourceHash"] = imported_hash
    try:
        with tempfile.TemporaryDirectory(prefix="hardware-study-") as directory, contextlib.redirect_stdout(sys.stderr):
            kind = request.get("type")
            if kind == "strength":
                from .analysis.strength import strength
                result = strength(request,directory)
            elif kind == "manufacturing":
                from .analysis.manufacturing import manufacturing
                result = manufacturing(request,directory)
            elif kind == "mechanism":
                from .analysis.mechanism import mechanism
                result = mechanism(request,directory)
            else:
                raise StudyError("Study type must be strength, manufacturing or mechanism")
        return {**result, **binding}
    except StudyError as error:
        return {"status":error.status,"type":request.get("type"),"error":str(error),**binding}
    except Exception as error:
        # The caller owns private worker logs; paths and source data are not returned.
        print(f"Engineering worker error: {type(error).__name__}: {error}",file=sys.stderr)
        return {"status":"failed","type":request.get("type"),"error":"Engineering worker failed; inspect the worker diagnostics",**binding}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--input",type=Path)
    args=parser.parse_args()
    try:
        raw=args.input.read_text() if args.input else sys.stdin.read(8*1024*1024+1)
        if len(raw)>8*1024*1024:
            raise ValueError("Request exceeds 8 MB")
        request=json.loads(raw,parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Invalid JSON number: {value}")))
        result=run(request)
    except (ValueError,OSError) as error:
        result={"status":"needs_inputs","error":str(error)}
    print(json.dumps(result,separators=(",",":"),allow_nan=False))
    return 0 if result["status"] in ("solved","unconverged") else 2


if __name__=="__main__":
    raise SystemExit(main())
