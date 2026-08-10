// wrangler のモジュールルール: .wasm は CompiledWasm、.ttf は Data(ArrayBuffer)
declare module '*.wasm' {
  const mod: WebAssembly.Module;
  export default mod;
}
declare module '*.ttf' {
  const data: ArrayBuffer;
  export default data;
}
