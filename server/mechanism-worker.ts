import { readFileSync } from 'node:fs';
import { simulateMechanism } from './mechanism-solver';
try {const input=JSON.parse(readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(await simulateMechanism(input.snapshot,input.mechanism,input.source)));}
catch(error){console.log(JSON.stringify({status:'needs_inputs',message:error instanceof Error?error.message:'Review the joint setup.'}));process.exitCode=2;}
