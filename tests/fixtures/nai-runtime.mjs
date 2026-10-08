/** 使用当前代码中的公开默认值构造快照，不读取用户最近一次联网同步结果。 */
export const createNaiRuntimeSnapshot = runtime => ({
  syncedAt: 1,
  runtime: structuredClone(runtime),
  health: { ok: true, extracted: [], missed: [] },
});

/** 合成的官方计费结构，数值与变量均可替换；不含用户数据或整份远端源码。 */
export const NAI_BILLING_BUNDLE = [
  'function C(e){return!e.characterRef&&e.width*e.height<=1048576&&e.steps<=28}',
  'let d=function(e,t,a){let v=e.n_samples;(0,c.t1)(e)&&t.subscription.tier>=3&&(0,n.ax)(t.subscription)&&!D&&!m&&(v-=1);let w=Math.ceil(2951823174884865e-21*i+5753298233447344e-22*i*a)*(r?1.4:n?1.2:1);(0,r.Jg)(a)===r.lh.v5&&(w*=1.5);let y=Math.max(Math.ceil(w*p),2);return y*v},p=2;function M(e){return Math.max(0,e-4)*p}',
  'async(t,r,i,a,n,o,s,l,c,d,h)=>{let u={...a};let g=0;g+=await priceForEncoding(s);g+=(0,q.H_0)(s.length);l&&characterReferences&&l.length>0&&(!a.mask||charRefInpainting)&&(g+=5*l.length*u.n_samples);d({price:(0,q.GIT)(u,p,f)+g,additionalPrice:g})}',
  'async getPrice(e,t,r,i){return await this.getEncoding(e,r,i)?{exists:!0,price:0}:{exists:!1,price:2}}',
].join(';');

/** 合成 V5 Medium 新算式，保留旧算式夹具验证兼容；不复制远端完整代码。 */
export const NAI_MEDIUM_BILLING_BUNDLE = NAI_BILLING_BUNDLE.replace(
  'let w=Math.ceil(2951823174884865e-21*i+5753298233447344e-22*i*a)*(r?1.4:n?1.2:1);',
  'let w=function(e,t,a,n,r){let i=arguments.length>5&&void 0!==arguments[5]?arguments[5]:1,l=e*t;return Math.ceil(2951823174884865e-21*l+5753298233447344e-22*l*a*i)*(r?1.4:n?1.2:1)}(f,d,M,t,t&&n,function(e){switch(e){case r.oM.naiDiffusionV5FullMedium:case r.oM.naiDiffusionV5FullMediumInpainting:return 1/1.06521739;default:return 1}}(a));',
);
