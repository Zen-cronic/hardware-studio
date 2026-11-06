"""Inventory installed production dependencies against the committed lockfiles.
Run with the project's Python environment; no network access or installs.
"""
import argparse, hashlib, json, re, sys, tomllib
from importlib.metadata import distribution
from pathlib import Path
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--npm-root', type=Path, default=Path('.'))
parser.add_argument('--output', type=Path, default=Path('docs/third-party-runtime.json'))
args = parser.parse_args()
root = Path.cwd()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def notice(p, relative): return {'path': str(relative), 'sha256': sha(p)}
lock = json.loads((root/'package-lock.json').read_text())
installed = json.loads((args.npm_root/'node_modules/.package-lock.json').read_text())
manifest = json.loads((root/'package.json').read_text())
npm=[]
for path, record in sorted(installed['packages'].items()):
    if not path or record.get('dev'): continue
    expected=lock['packages'][path]
    assert record['version']==expected['version'], path
    package=args.npm_root/path
    m=json.loads((package/'package.json').read_text())
    assert m['version']==record['version'], path
    licenses=[]
    for p in sorted(package.iterdir()):
        if p.is_file() and re.match(r'^(licen[cs]e|copying|notice)([.\-_]|$)',p.name,re.I):
            licenses.append(notice(p,p.name))
    declared=expected.get('license') or m.get('license')
    provenance='package-lock.json / package metadata'
    if m['name']=='webgl-constants' and not declared:
        assert (package/'LICENSE').read_text().startswith('MIT License')
        declared='MIT';provenance='installed LICENSE text'
    repo=m.get('repository',{})
    repo=repo.get('url') if isinstance(repo,dict) else repo
    npm.append({'name':m['name'],'version':m['version'],'path':path,'direct':path=='node_modules/'+m['name'] and m['name'] in manifest['dependencies'],'license':declared or 'UNRESOLVED','licenseProvenance':provenance,'source':expected.get('resolved') or 'UNRESOLVED','repository':repo,'notices':licenses})
locked={canonicalize_name(p['name']):p['version'] for p in tomllib.loads((root/'poetry.lock').read_text())['package']}
direct_python=[Requirement(value) for value in tomllib.loads((root/'pyproject.toml').read_text())['project']['dependencies']]
direct_python_names={canonicalize_name(req.name) for req in direct_python}
queue=[(req.name,frozenset(req.extras)) for req in direct_python]; contexts=set(); python={}
license_labels={'addict':'MIT','blinker':'MIT','itsdangerous':'BSD-3-Clause','jinja2':'BSD-3-Clause','netgen-occt':'LGPL-2.1 text included (OCCT; review additional exception and distribution obligations)','scikit-fem':'BSD-3-Clause','cadquery':'Apache-2.0','cadquery-ocp':'Apache-2.0 (wrapper; OCCT separately licensed)','trame-common':'Apache-2.0','wslink':'BSD-3-Clause','ezdxf':'MIT','multimethod':'Apache-2.0','kiwisolver':'BSD-3-Clause','cycler':'BSD-3-Clause','matplotlib':'Matplotlib license (see installed LICENSE)','vtk':'BSD-3-Clause (additional bundled notices apply)'}
while queue:
    name,extras=queue.pop(); name=canonicalize_name(name); key=(name,extras)
    if key in contexts: continue
    contexts.add(key);d=distribution(name);m=d.metadata
    assert m['Version']==locked[name], (name,m['Version'],locked.get(name))
    files=[]
    for f in d.files or []:
        if re.search(r'(^|/)(licen[cs]e[^/]*|copying[^/]*|notice[^/]*)$',str(f),re.I):
            p=d.locate_file(f)
            if p.is_file():files.append(notice(p,f))
    declared=m.get('License-Expression') or m.get('License') or ''
    python[name]={'name':name,'version':m['Version'],'direct':name in direct_python_names,'license':license_labels.get(name,declared or 'UNRESOLVED'),'licenseProvenance':'installed metadata and license text; labels are descriptive, not a compatibility determination','source':f'https://pypi.org/project/{name}/{m["Version"]}/','projectUrls':m.get_all('Project-URL') or [],'notices':sorted(files,key=lambda f:f['path'])}
    for s in d.requires or []:
        req=Requirement(s)
        if not req.marker or any(req.marker.evaluate({'extra':x}) for x in ({''}|set(extras))):
            queue.append((req.name,frozenset(req.extras)))
fonts=[]
for p in sorted((root/'public/fonts').glob('*.woff2')):
    family=p.name.split('-')[0]
    fonts.append({'path':str(p.relative_to(root)),'sha256':sha(p),'license':'OFL-1.1','source':f'https://cdn.jsdelivr.net/npm/@fontsource/{family}/files/{p.name}','notice':f'public/fonts/licenses/{family}-OFL.txt'})
result={'schemaVersion':1,'scope':'Installed production npm packages on this platform and declared Python runtime dependency closures; not a complete audit of nested binary components or development tools. Runtime package presence is not proof of import/use. Other platforms may select additional optional packages.','lockSha256':{'package-lock.json':sha(root/'package-lock.json'),'poetry.lock':sha(root/'poetry.lock')},'npm':npm,'python':list(sorted(python.values(),key=lambda p:p['name'])),'vendoredFonts':fonts}
unresolved=[p['name'] for p in npm+result['python'] if p['license'] in {'UNRESOLVED','UNKNOWN'} or p['source']=='UNRESOLVED']
assert not unresolved, 'Missing attribution: '+', '.join(unresolved)
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'npm':len(npm),'python':len(python),'fonts':len(fonts),'lockVersionsMatch':True,'output':str(args.output)}))
