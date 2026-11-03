export const VS = `#version 300 es
const vec2 P[3]=vec2[3](vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0));
void main(){gl_Position=vec4(P[gl_VertexID],0.0,1.0);}`;
export const FS = `#version 300 es
precision highp float;precision highp int;
uniform sampler2D uA;uniform sampler2D uB;uniform sampler2D uAtlas;
uniform ivec2 uCell;uniform int uAtlasCols;uniform vec2 uRes;uniform int uMode;
uniform float uEffects;
out vec4 o;
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);p.y=int(uRes.y)-1-p.y;
  ivec2 c=p/uCell;ivec2 inC=p-c*uCell;
  vec4 a=texelFetch(uA,c,0);vec4 b=texelFetch(uB,c,0);
  int g=int(a.a*255.0+0.5)+int(b.a*255.0+0.5)*256;
  ivec2 ag=ivec2(g-(g/uAtlasCols)*uAtlasCols,g/uAtlasCols);
  float cov=texelFetch(uAtlas,ag*uCell+inC,0).a;
  vec3 col=mix(b.rgb,a.rgb,cov);
  if(uEffects>0.001 && uMode!=2){
    // Preserve the full-resolution glyph, with no blur into adjacent characters.
    col*=1.0+0.12*uEffects*cov;
  }
  vec2 uv=gl_FragCoord.xy/uRes;
  float v=length((uv-0.5)*vec2(1.0,0.9));
  col*=mix(1.0,0.74,smoothstep(0.35,0.85,v));
  if(uMode==1){float l=dot(col,vec3(0.3,0.59,0.11));col=vec3(0.2,1.0,0.52)*pow(l,0.85)*1.25+vec3(0.0,0.014,0.006);}
  else if(uMode==2){float l=dot(col,vec3(0.3,0.59,0.11));col=mix(vec3(0.925,0.91,0.87),vec3(0.13,0.12,0.16),clamp(pow(l,0.8)*1.7,0.0,1.0));}
  o=vec4(col,1.0);
}`;
