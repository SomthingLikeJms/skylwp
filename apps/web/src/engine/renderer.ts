import type { World, Theme } from '../world/types';
import { GlyphAtlas } from './atlas';
import { VS, FS } from './shaders';

export class Renderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private textures: WebGLTexture[];
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private previousA = new Uint8Array(0);
  private previousB = new Uint8Array(0);
  private previousTheme: Theme | null = null;
  private previousEffects = -1;
  private vertexArray: WebGLVertexArrayObject;
  atlas: GlyphAtlas;
  lost = false;
  uploads = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    cellWidth: number,
    cellHeight: number,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    if (!gl) throw new Error('当前环境不支持 WebGL2');
    this.gl = gl;
    this.atlas = new GlyphAtlas(cellWidth, cellHeight);
    const program = gl.createProgram();
    if (!program) throw new Error('无法创建渲染程序');
    this.program = program;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, FS],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('无法创建着色器');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? '着色器编译失败');
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? '着色器链接失败');
    gl.useProgram(program);
    for (const name of ['uA', 'uB', 'uAtlas', 'uCell', 'uAtlasCols', 'uRes', 'uMode', 'uEffects'])
      this.uniforms[name] = gl.getUniformLocation(program, name);
    gl.uniform1i(this.uniforms.uA, 0);
    gl.uniform1i(this.uniforms.uB, 1);
    gl.uniform1i(this.uniforms.uAtlas, 2);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('无法创建顶点数组');
    this.vertexArray = vao;
    gl.bindVertexArray(vao);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.textures = [0, 1, 2].map((unit) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('无法创建渲染纹理');
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const prop of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.texParameteri(gl.TEXTURE_2D, prop, gl.NEAREST);
      for (const prop of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
        gl.texParameteri(gl.TEXTURE_2D, prop, gl.CLAMP_TO_EDGE);
      return texture;
    });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
    });
  }

  resize(world: World, cellWidth: number, cellHeight: number, dpr: number): void {
    const gl = this.gl;
    this.canvas.width = world.cols * cellWidth;
    this.canvas.height = world.rows * cellHeight;
    this.canvas.style.width = `${this.canvas.width / dpr}px`;
    this.canvas.style.height = `${this.canvas.height / dpr}px`;
    if (this.atlas.cellWidth !== cellWidth || this.atlas.cellHeight !== cellHeight)
      this.atlas = new GlyphAtlas(cellWidth, cellHeight);
    this.previousA = new Uint8Array(world.A.length);
    this.previousB = new Uint8Array(world.B.length);
    this.previousTheme = null;
    for (let i = 0; i < 2; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        world.cols,
        world.rows,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    gl.uniform2i(this.uniforms.uCell, cellWidth, cellHeight);
    gl.uniform1i(this.uniforms.uAtlasCols, this.atlas.columns);
    gl.uniform2f(this.uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(world: World, theme: Theme, effects = 0): void {
    if (this.lost) return;
    const gl = this.gl;
    if (this.atlas.dirty) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[2]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
      this.atlas.dirty = false;
    }
    this.uploads = 0;
    const rowBytes = world.cols * 4;
    let first = -1;
    const flush = (last: number) => {
      if (first < 0) return;
      for (let unit = 0; unit < 2; unit++) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          first,
          world.cols,
          last - first,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          unit === 0 ? world.A : world.B,
          first * rowBytes,
        );
        this.uploads++;
      }
      first = -1;
    };
    for (let row = 0; row < world.rows; row++) {
      let changed = this.previousTheme === null;
      for (let i = row * rowBytes, end = i + rowBytes; !changed && i < end; i++)
        changed = world.A[i] !== this.previousA[i] || world.B[i] !== this.previousB[i];
      if (changed && first < 0) first = row;
      else if (!changed) flush(row);
    }
    flush(world.rows);
    this.previousA.set(world.A);
    this.previousB.set(world.B);
    if (this.uploads || this.previousTheme !== theme || this.previousEffects !== effects) {
      gl.uniform1f(this.uniforms.uEffects, effects);
      gl.uniform1i(this.uniforms.uMode, theme === 'phosphor' ? 1 : theme === 'ink' ? 2 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.previousTheme = theme;
    this.previousEffects = effects;
  }

  dispose(): void {
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.gl.deleteVertexArray(this.vertexArray);
    this.gl.deleteProgram(this.program);
  }
}
