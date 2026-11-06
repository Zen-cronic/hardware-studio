import type { Part } from './types';
/** Editable example geometry. Dimensions are declared design inputs, not fabrication certification. */
export function deskArmParts():Part[] {
 const plate=(id:string,name:string,size:[number,number,number],position:[number,number,number],extra:Partial<Part>={}):Part=>({id,name,shape:'box',size,position,color:'#75bde5',material:'Aluminum 6061-T6',process:'machine',...extra});
 const pin=(id:string,position:[number,number,number],height:number):Part=>({id,name:id.replaceAll('-',' '),shape:'cylinder',size:[6,height,6],position,color:'#afbecb',material:'Steel',process:'buy'});
 const angle=-Math.PI/6,c=Math.cos(angle),s=-Math.sin(angle),x=110+45*c,z=45*s;
 return [
  plate('base-plate','Desk clamp top plate',[80,8,65],[0,4,0],{holes:[{x:10,z:0,diameter:26}]}),
  plate('clamp-back','Desk clamp back',[8,65,65],[-36,-24.5,0]),
  plate('clamp-bottom','Desk clamp bottom',[80,8,65],[0,-53,0],{holes:[{x:8,z:0,diameter:8.4}]}),
  {id:'clamp-screw',name:'M8 clamp screw envelope',shape:'cylinder',size:[8,45,8],position:[8,-34,0],color:'#afbecb',material:'Steel',process:'buy'},
  {id:'clamp-pad',name:'Desk contact pad',shape:'cylinder',size:[28,5,28],position:[8,-14,0],color:'#193e5a',material:'TPU',process:'print'},
  {id:'column',name:'Vertical support column',shape:'tube',size:[25,60,25],holeDiameter:7,position:[10,38,0],color:'#2b6d9e',material:'Aluminum 6061-T6',process:'machine'},
  plate('lower-arm','Lower arm link',[120,4,24],[60,70,0],{holes:[{x:-50,z:0,diameter:6.4},{x:50,z:0,diameter:6.4}]}),
  plate('upper-arm','Upper arm link',[110,4,24],[x,78,z],{rotation:[0,angle,0],holes:[{x:-45,z:0,diameter:6.4},{x:45,z:0,diameter:6.4}]}),
  pin('shoulder-pin',[10,70,0],20),pin('elbow-pin',[110,74,0],20),
  plate('camera-platform','Camera mounting platform',[60,6,50],[110+90*c,84,90*s],{holes:[{x:0,z:0,diameter:6.5}]}),
  {id:'test-payload',name:'Declared 0.5 kg test payload envelope',shape:'box',size:[65,45,40],position:[110+90*c,109.5,90*s],color:'#173a56',material:'Reference envelope',process:'buy',role:'reference'},
 ];
}
