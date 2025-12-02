import{n as ct,a9 as ut,e as Y,c as i,aa as ht,ab as ft,b as z,f as ne,ac as Me,ad as vt,d as Ae,h as C,ae as mt,af as bt,t as gt,ag as pt,ah as ge,ai as wt,u as xt,A as $e,x as D,aj as kt,C as T,y as yt,z as Ct,ak as pe,al as St,D as Re,am as zt,I as le,an as ie,ao as se,ap as ve,a2 as $,S as _,Z as N,_ as Mt,M as me,O as M,T as R,a1 as be,P as w,Q as q,a0 as Rt,V as re,$ as I,aq as Te,N as Tt,B as _e,ar as _t,a3 as De,a4 as Be}from"./index-BtwJCbgC.js";import{S as Dt}from"./SearchOutlined-CjUBV9Un.js";import{N as Bt}from"./text-Cd-Zb_pf.js";import{N as Vt}from"./Divider-BS-sb4AV.js";function It(o){const d="rgba(0, 0, 0, .85)",g="0 2px 8px 0 rgba(0, 0, 0, 0.12)",{railColor:x,primaryColor:f,baseColor:c,cardColor:k,modalColor:v,popoverColor:E,borderRadius:V,fontSize:O,opacityDisabled:j}=o;return Object.assign(Object.assign({},ut),{fontSize:O,markFontSize:O,railColor:x,railColorHover:x,fillColor:f,fillColorHover:f,opacityDisabled:j,handleColor:"#FFF",dotColor:k,dotColorModal:v,dotColorPopover:E,handleBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowHover:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowActive:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowFocus:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",indicatorColor:d,indicatorBoxShadow:g,indicatorTextColor:c,indicatorBorderRadius:V,dotBorder:`2px solid ${x}`,dotBorderActive:`2px solid ${f}`,dotBoxShadow:""})}const At={common:ct,self:It},$t=Y([i("slider",`
 display: block;
 padding: calc((var(--n-handle-size) - var(--n-rail-height)) / 2) 0;
 position: relative;
 z-index: 0;
 width: 100%;
 cursor: pointer;
 user-select: none;
 -webkit-user-select: none;
 `,[z("reverse",[i("slider-handles",[i("slider-handle-wrapper",`
 transform: translate(50%, -50%);
 `)]),i("slider-dots",[i("slider-dot",`
 transform: translateX(50%, -50%);
 `)]),z("vertical",[i("slider-handles",[i("slider-handle-wrapper",`
 transform: translate(-50%, -50%);
 `)]),i("slider-marks",[i("slider-mark",`
 transform: translateY(calc(-50% + var(--n-dot-height) / 2));
 `)]),i("slider-dots",[i("slider-dot",`
 transform: translateX(-50%) translateY(0);
 `)])])]),z("vertical",`
 box-sizing: content-box;
 padding: 0 calc((var(--n-handle-size) - var(--n-rail-height)) / 2);
 width: var(--n-rail-width-vertical);
 height: 100%;
 `,[i("slider-handles",`
 top: calc(var(--n-handle-size) / 2);
 right: 0;
 bottom: calc(var(--n-handle-size) / 2);
 left: 0;
 `,[i("slider-handle-wrapper",`
 top: unset;
 left: 50%;
 transform: translate(-50%, 50%);
 `)]),i("slider-rail",`
 height: 100%;
 `,[ne("fill",`
 top: unset;
 right: 0;
 bottom: unset;
 left: 0;
 `)]),z("with-mark",`
 width: var(--n-rail-width-vertical);
 margin: 0 32px 0 8px;
 `),i("slider-marks",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 22px;
 font-size: var(--n-mark-font-size);
 `,[i("slider-mark",`
 transform: translateY(50%);
 white-space: nowrap;
 `)]),i("slider-dots",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 50%;
 `,[i("slider-dot",`
 transform: translateX(-50%) translateY(50%);
 `)])]),z("disabled",`
 cursor: not-allowed;
 opacity: var(--n-opacity-disabled);
 `,[i("slider-handle",`
 cursor: not-allowed;
 `)]),z("with-mark",`
 width: 100%;
 margin: 8px 0 32px 0;
 `),Y("&:hover",[i("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[ne("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),i("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),z("active",[i("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[ne("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),i("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),i("slider-marks",`
 position: absolute;
 top: 18px;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[i("slider-mark",`
 position: absolute;
 transform: translateX(-50%);
 white-space: nowrap;
 `)]),i("slider-rail",`
 width: 100%;
 position: relative;
 height: var(--n-rail-height);
 background-color: var(--n-rail-color);
 transition: background-color .3s var(--n-bezier);
 border-radius: calc(var(--n-rail-height) / 2);
 `,[ne("fill",`
 position: absolute;
 top: 0;
 bottom: 0;
 border-radius: calc(var(--n-rail-height) / 2);
 transition: background-color .3s var(--n-bezier);
 background-color: var(--n-fill-color);
 `)]),i("slider-handles",`
 position: absolute;
 top: 0;
 right: calc(var(--n-handle-size) / 2);
 bottom: 0;
 left: calc(var(--n-handle-size) / 2);
 `,[i("slider-handle-wrapper",`
 outline: none;
 position: absolute;
 top: 50%;
 transform: translate(-50%, -50%);
 cursor: pointer;
 display: flex;
 `,[i("slider-handle",`
 height: var(--n-handle-size);
 width: var(--n-handle-size);
 border-radius: 50%;
 overflow: hidden;
 transition: box-shadow .2s var(--n-bezier), background-color .3s var(--n-bezier);
 background-color: var(--n-handle-color);
 box-shadow: var(--n-handle-box-shadow);
 `,[Y("&:hover",`
 box-shadow: var(--n-handle-box-shadow-hover);
 `)]),Y("&:focus",[i("slider-handle",`
 box-shadow: var(--n-handle-box-shadow-focus);
 `,[Y("&:hover",`
 box-shadow: var(--n-handle-box-shadow-active);
 `)])])])]),i("slider-dots",`
 position: absolute;
 top: 50%;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[z("transition-disabled",[i("slider-dot","transition: none;")]),i("slider-dot",`
 transition:
 border-color .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 position: absolute;
 transform: translate(-50%, -50%);
 height: var(--n-dot-height);
 width: var(--n-dot-width);
 border-radius: var(--n-dot-border-radius);
 overflow: hidden;
 box-sizing: border-box;
 border: var(--n-dot-border);
 background-color: var(--n-dot-color);
 `,[z("active","border: var(--n-dot-border-active);")])])]),i("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[Me()]),i("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[z("top",`
 margin-bottom: 12px;
 `),z("right",`
 margin-left: 12px;
 `),z("bottom",`
 margin-top: 12px;
 `),z("left",`
 margin-right: 12px;
 `),Me()]),ht(i("slider",[i("slider-dot","background-color: var(--n-dot-color-modal);")])),ft(i("slider",[i("slider-dot","background-color: var(--n-dot-color-popover);")]))]);function Ve(o){return window.TouchEvent&&o instanceof window.TouchEvent}function Ie(){const o=new Map,d=g=>x=>{o.set(g,x)};return vt(()=>{o.clear()}),[o,d]}const Nt=0,Ft=Object.assign(Object.assign({},$e.props),{to:ge.propTo,defaultValue:{type:[Number,Array],default:0},marks:Object,disabled:{type:Boolean,default:void 0},formatTooltip:Function,keyboard:{type:Boolean,default:!0},min:{type:Number,default:0},max:{type:Number,default:100},step:{type:[Number,String],default:1},range:Boolean,value:[Number,Array],placement:String,showTooltip:{type:Boolean,default:void 0},tooltip:{type:Boolean,default:!0},vertical:Boolean,reverse:Boolean,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onDragstart:[Function],onDragend:[Function]}),ta=Ae({name:"Slider",props:Ft,slots:Object,setup(o){const{mergedClsPrefixRef:d,namespaceRef:g,inlineThemeDisabled:x}=xt(o),f=$e("Slider","-slider",$t,At,o,d),c=D(null),[k,v]=Ie(),[E,V]=Ie(),O=D(new Set),j=kt(o),{mergedDisabledRef:P}=j,Q=T(()=>{const{step:e}=o;if(Number(e)<=0||e==="mark")return 0;const t=e.toString();let a=0;return t.includes(".")&&(a=t.length-t.indexOf(".")-1),a}),G=D(o.defaultValue),K=yt(o,"value"),X=Ct(K,G),S=T(()=>{const{value:e}=X;return(o.range?e:[e]).map(ye)}),l=T(()=>S.value.length>2),m=T(()=>o.placement===void 0?o.vertical?"right":"top":o.placement),u=T(()=>{const{marks:e}=o;return e?Object.keys(e).map(Number.parseFloat):null}),n=D(-1),r=D(-1),F=D(-1),H=D(!1),W=D(!1),de=T(()=>{const{vertical:e,reverse:t}=o;return e?t?"top":"bottom":t?"right":"left"}),Ne=T(()=>{if(l.value)return;const e=S.value,t=Z(o.range?Math.min(...e):o.min),a=Z(o.range?Math.max(...e):e[0]),{value:s}=de;return o.vertical?{[s]:`${t}%`,height:`${a-t}%`}:{[s]:`${t}%`,width:`${a-t}%`}}),Fe=T(()=>{const e=[],{marks:t}=o;if(t){const a=S.value.slice();a.sort((y,p)=>y-p);const{value:s}=de,{value:h}=l,{range:b}=o,B=h?()=>!1:y=>b?y>=a[0]&&y<=a[a.length-1]:y<=a[0];for(const y of Object.keys(t)){const p=Number(y);e.push({active:B(p),key:p,label:t[y],style:{[s]:`${Z(p)}%`}})}}return e});function He(e,t){const a=Z(e),{value:s}=de;return{[s]:`${a}%`,zIndex:t===n.value?1:0}}function we(e){return o.showTooltip||F.value===e||n.value===e&&H.value}function Ee(e){return H.value?!(n.value===e&&r.value===e):!0}function Oe(e){var t;~e&&(n.value=e,(t=k.get(e))===null||t===void 0||t.focus())}function je(){E.forEach((e,t)=>{we(t)&&e.syncPosition()})}function xe(e){const{"onUpdate:value":t,onUpdateValue:a}=o,{nTriggerFormInput:s,nTriggerFormChange:h}=j;a&&le(a,e),t&&le(t,e),G.value=e,s(),h()}function ke(e){const{range:t}=o;if(t){if(Array.isArray(e)){const{value:a}=S;e.join()!==a.join()&&xe(e)}}else Array.isArray(e)||S.value[0]!==e&&xe(e)}function ce(e,t){if(o.range){const a=S.value.slice();a.splice(t,1,e),ke(a)}else ke(e)}function ue(e,t,a){const s=a!==void 0;a||(a=e-t>0?1:-1);const h=u.value||[],{step:b}=o;if(b==="mark"){const p=J(e,h.concat(t),s?a:void 0);return p?p.value:t}if(b<=0)return t;const{value:B}=Q;let y;if(s){const p=Number((t/b).toFixed(B)),A=Math.floor(p),he=p>A?A:A-1,fe=p<A?A:A+1;y=J(t,[Number((he*b).toFixed(B)),Number((fe*b).toFixed(B)),...h],a)}else{const p=Le(e);y=J(e,[...h,p])}return y?ye(y.value):t}function ye(e){return Math.min(o.max,Math.max(o.min,e))}function Z(e){const{max:t,min:a}=o;return(e-a)/(t-a)*100}function Pe(e){const{max:t,min:a}=o;return a+(t-a)*e}function Le(e){const{step:t,min:a}=o;if(Number(t)<=0||t==="mark")return e;const s=Math.round((e-a)/t)*t+a;return Number(s.toFixed(Q.value))}function J(e,t=u.value,a){if(!t?.length)return null;let s=null,h=-1;for(;++h<t.length;){const b=t[h]-e,B=Math.abs(b);(a===void 0||b*a>0)&&(s===null||B<s.distance)&&(s={index:h,distance:B,value:t[h]})}return s}function Ce(e){const t=c.value;if(!t)return;const a=Ve(e)?e.touches[0]:e,s=t.getBoundingClientRect();let h;return o.vertical?h=(s.bottom-a.clientY)/s.height:h=(a.clientX-s.left)/s.width,o.reverse&&(h=1-h),Pe(h)}function Ue(e){if(P.value||!o.keyboard)return;const{vertical:t,reverse:a}=o;switch(e.key){case"ArrowUp":e.preventDefault(),ee(t&&a?-1:1);break;case"ArrowRight":e.preventDefault(),ee(!t&&a?-1:1);break;case"ArrowDown":e.preventDefault(),ee(t&&a?1:-1);break;case"ArrowLeft":e.preventDefault(),ee(!t&&a?1:-1);break}}function ee(e){const t=n.value;if(t===-1)return;const{step:a}=o,s=S.value[t],h=Number(a)<=0||a==="mark"?s:s+a*e;ce(ue(h,s,e>0?1:-1),t)}function Ge(e){var t,a;if(P.value||!Ve(e)&&e.button!==Nt)return;const s=Ce(e);if(s===void 0)return;const h=S.value.slice(),b=o.range?(a=(t=J(s,h))===null||t===void 0?void 0:t.index)!==null&&a!==void 0?a:-1:0;b!==-1&&(e.preventDefault(),Oe(b),Ke(),ce(ue(s,S.value[b]),b))}function Ke(){H.value||(H.value=!0,o.onDragstart&&le(o.onDragstart),ie("touchend",document,oe),ie("mouseup",document,oe),ie("touchmove",document,ae),ie("mousemove",document,ae))}function te(){H.value&&(H.value=!1,o.onDragend&&le(o.onDragend),se("touchend",document,oe),se("mouseup",document,oe),se("touchmove",document,ae),se("mousemove",document,ae))}function ae(e){const{value:t}=n;if(!H.value||t===-1){te();return}const a=Ce(e);a!==void 0&&ce(ue(a,S.value[t]),t)}function oe(){te()}function Xe(e){n.value=e,P.value||(F.value=e)}function Ye(e){n.value===e&&(n.value=-1,te()),F.value===e&&(F.value=-1)}function qe(e){F.value=e}function Qe(e){F.value===e&&(F.value=-1)}pe(n,(e,t)=>void ve(()=>r.value=t)),pe(X,()=>{if(o.marks){if(W.value)return;W.value=!0,ve(()=>{W.value=!1})}ve(je)}),St(()=>{te()});const Se=T(()=>{const{self:{markFontSize:e,railColor:t,railColorHover:a,fillColor:s,fillColorHover:h,handleColor:b,opacityDisabled:B,dotColor:y,dotColorModal:p,handleBoxShadow:A,handleBoxShadowHover:he,handleBoxShadowActive:fe,handleBoxShadowFocus:We,dotBorder:Ze,dotBoxShadow:Je,railHeight:et,railWidthVertical:tt,handleSize:at,dotHeight:ot,dotWidth:nt,dotBorderRadius:lt,fontSize:it,dotBorderActive:st,dotColorPopover:rt},common:{cubicBezierEaseInOut:dt}}=f.value;return{"--n-bezier":dt,"--n-dot-border":Ze,"--n-dot-border-active":st,"--n-dot-border-radius":lt,"--n-dot-box-shadow":Je,"--n-dot-color":y,"--n-dot-color-modal":p,"--n-dot-color-popover":rt,"--n-dot-height":ot,"--n-dot-width":nt,"--n-fill-color":s,"--n-fill-color-hover":h,"--n-font-size":it,"--n-handle-box-shadow":A,"--n-handle-box-shadow-active":fe,"--n-handle-box-shadow-focus":We,"--n-handle-box-shadow-hover":he,"--n-handle-color":b,"--n-handle-size":at,"--n-opacity-disabled":B,"--n-rail-color":t,"--n-rail-color-hover":a,"--n-rail-height":et,"--n-rail-width-vertical":tt,"--n-mark-font-size":e}}),L=x?Re("slider",void 0,Se,o):void 0,ze=T(()=>{const{self:{fontSize:e,indicatorColor:t,indicatorBoxShadow:a,indicatorTextColor:s,indicatorBorderRadius:h}}=f.value;return{"--n-font-size":e,"--n-indicator-border-radius":h,"--n-indicator-box-shadow":a,"--n-indicator-color":t,"--n-indicator-text-color":s}}),U=x?Re("slider-indicator",void 0,ze,o):void 0;return{mergedClsPrefix:d,namespace:g,uncontrolledValue:G,mergedValue:X,mergedDisabled:P,mergedPlacement:m,isMounted:zt(),adjustedTo:ge(o),dotTransitionDisabled:W,markInfos:Fe,isShowTooltip:we,shouldKeepTooltipTransition:Ee,handleRailRef:c,setHandleRefs:v,setFollowerRefs:V,fillStyle:Ne,getHandleStyle:He,activeIndex:n,arrifiedValues:S,followerEnabledIndexSet:O,handleRailMouseDown:Ge,handleHandleFocus:Xe,handleHandleBlur:Ye,handleHandleMouseEnter:qe,handleHandleMouseLeave:Qe,handleRailKeyDown:Ue,indicatorCssVars:x?void 0:ze,indicatorThemeClass:U?.themeClass,indicatorOnRender:U?.onRender,cssVars:x?void 0:Se,themeClass:L?.themeClass,onRender:L?.onRender}},render(){var o;const{mergedClsPrefix:d,themeClass:g,formatTooltip:x}=this;return(o=this.onRender)===null||o===void 0||o.call(this),C("div",{class:[`${d}-slider`,g,{[`${d}-slider--disabled`]:this.mergedDisabled,[`${d}-slider--active`]:this.activeIndex!==-1,[`${d}-slider--with-mark`]:this.marks,[`${d}-slider--vertical`]:this.vertical,[`${d}-slider--reverse`]:this.reverse}],style:this.cssVars,onKeydown:this.handleRailKeyDown,onMousedown:this.handleRailMouseDown,onTouchstart:this.handleRailMouseDown},C("div",{class:`${d}-slider-rail`},C("div",{class:`${d}-slider-rail__fill`,style:this.fillStyle}),this.marks?C("div",{class:[`${d}-slider-dots`,this.dotTransitionDisabled&&`${d}-slider-dots--transition-disabled`]},this.markInfos.map(f=>C("div",{key:f.key,class:[`${d}-slider-dot`,{[`${d}-slider-dot--active`]:f.active}],style:f.style}))):null,C("div",{ref:"handleRailRef",class:`${d}-slider-handles`},this.arrifiedValues.map((f,c)=>{const k=this.isShowTooltip(c);return C(mt,null,{default:()=>[C(bt,null,{default:()=>C("div",{ref:this.setHandleRefs(c),class:`${d}-slider-handle-wrapper`,tabindex:this.mergedDisabled?-1:0,role:"slider","aria-valuenow":f,"aria-valuemin":this.min,"aria-valuemax":this.max,"aria-orientation":this.vertical?"vertical":"horizontal","aria-disabled":this.disabled,style:this.getHandleStyle(f,c),onFocus:()=>{this.handleHandleFocus(c)},onBlur:()=>{this.handleHandleBlur(c)},onMouseenter:()=>{this.handleHandleMouseEnter(c)},onMouseleave:()=>{this.handleHandleMouseLeave(c)}},gt(this.$slots.thumb,()=>[C("div",{class:`${d}-slider-handle`})]))}),this.tooltip&&C(pt,{ref:this.setFollowerRefs(c),show:k,to:this.adjustedTo,enabled:this.showTooltip&&!this.range||this.followerEnabledIndexSet.has(c),teleportDisabled:this.adjustedTo===ge.tdkey,placement:this.mergedPlacement,containerClass:this.namespace},{default:()=>C(wt,{name:"fade-in-scale-up-transition",appear:this.isMounted,css:this.shouldKeepTooltipTransition(c),onEnter:()=>{this.followerEnabledIndexSet.add(c)},onAfterLeave:()=>{this.followerEnabledIndexSet.delete(c)}},{default:()=>{var v;return k?((v=this.indicatorOnRender)===null||v===void 0||v.call(this),C("div",{class:[`${d}-slider-handle-indicator`,this.indicatorThemeClass,`${d}-slider-handle-indicator--${this.mergedPlacement}`],style:this.indicatorCssVars},typeof x=="function"?x(f):f)):null}})})]})})),this.marks?C("div",{class:`${d}-slider-marks`},this.markInfos.map(f=>C("div",{key:f.key,class:`${d}-slider-mark`,style:f.style},typeof f.label=="function"?f.label():f.label))):null))}}),Ht={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},Et=Ae({name:"CheckCircleOutlined",render:function(d,g){return _(),$("svg",Ht,g[0]||(g[0]=[N("path",{d:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4l8-8z",fill:"currentColor"},null,-1)]))}}),Ot={class:"model-list-container"},jt={key:1,class:"group-list"},Pt=["onClick"],Lt={class:"group-name"},Ut={class:"group-count"},Gt=["onClick"],Kt={class:"expand-icon"},Xt={key:0,class:"model-list"},Yt=["checked","onChange"],qt=["title"],Qt={__name:"ModelSelector",props:{value:{type:Array,default:()=>[]},allModels:{type:Array,default:()=>[]},multiple:{type:Boolean,default:!0}},emits:["update:value"],setup(o,{emit:d}){const g=o,x=d,f=D(""),c=D(""),k=D(g.value.length);let v=new Set(g.value);pe(()=>g.value,l=>{v=new Set(l),k.value=l.length},{deep:!1});const E=T(()=>{const l={零一万物:[],OpenAI:[],Claude:[],Gemini:[],DeepSeek:[],"智谱 (GLM)":[],"Qwen (通义千问)":[],"Doubao (豆包)":[],"Mistral AI":[],Llama:[],Grok:[],"Kimi (Moonshot)":[],MiniMax:[],Cohere:[],其他:[]},m=f.value.toLowerCase();return g.allModels.filter(n=>n.toLowerCase().includes(m)).forEach(n=>{const r=n.toLowerCase();r.includes("yi-")||r.includes("零一")?l.零一万物.push(n):r.includes("gpt")||r.includes("o1")||r.includes("o3")||r.includes("davinci")?l.OpenAI.push(n):r.includes("claude")?l.Claude.push(n):r.includes("gemini")||r.includes("gemma")?l.Gemini.push(n):r.includes("deepseek")?l.DeepSeek.push(n):r.includes("glm")||r.includes("智谱")?l["智谱 (GLM)"].push(n):r.includes("qwen")||r.includes("qwq")?l["Qwen (通义千问)"].push(n):r.includes("doubao")||r.includes("豆包")?l["Doubao (豆包)"].push(n):r.includes("mistral")?l["Mistral AI"].push(n):r.includes("llama")?l.Llama.push(n):r.includes("grok")?l.Grok.push(n):r.includes("kimi")||r.includes("moonshot")?l["Kimi (Moonshot)"].push(n):r.includes("minimax")||r.includes("abab")?l.MiniMax.push(n):r.includes("cohere")||r.includes("command")?l.Cohere.push(n):l.其他.push(n)}),Object.entries(l).filter(([n,r])=>r.length>0).map(([n,r])=>({name:n,models:r}))});function V(){x("update:value",Array.from(v))}function O(){v=new Set(g.allModels),k.value=v.size,V()}function j(){v=new Set,k.value=0,V()}function P(l,m){m?.stopPropagation();for(const u of l.models)v.add(u);k.value=v.size,V(),c.value===l.name&&(c.value="",setTimeout(()=>c.value=l.name,0))}function Q(l,m){m?.stopPropagation();for(const u of l.models)v.delete(u);k.value=v.size,V(),c.value===l.name&&(c.value="",setTimeout(()=>c.value=l.name,0))}function G(l){c.value=c.value===l?"":l}function K(l){let m=0;for(const u of l.models)v.has(u)&&m++;return m}function X(l,m){v.has(l)?v.delete(l):v.add(l),k.value=v.size,V()}function S(l){return v.has(l)}return(l,m)=>(_(),me(w(q),{vertical:"",size:16},{default:M(()=>[R(w(q),{justify:"space-between",align:"center"},{default:M(()=>[R(w(q),{size:8},{default:M(()=>[R(w(Rt),{type:"success",bordered:!1,size:"medium"},{icon:M(()=>[R(w(Te),null,{default:M(()=>[R(w(Et))]),_:1})]),default:M(()=>[re(" 已选择 ("+I(k.value)+") ",1)]),_:1})]),_:1})]),_:1}),R(w(Tt),{value:f.value,"onUpdate:value":m[0]||(m[0]=u=>f.value=u),placeholder:"搜索模型",clearable:"",size:"large"},{prefix:M(()=>[R(w(Te),null,{default:M(()=>[R(w(Dt))]),_:1})]),_:1},8,["value"]),o.multiple?(_(),me(w(q),{key:0,justify:"space-between",align:"center"},{default:M(()=>[R(w(Bt),{depth:"3"},{default:M(()=>[re(" 已选择 "+I(k.value)+" / "+I(o.allModels.length),1)]),_:1}),R(w(q),{size:8},{default:M(()=>[R(w(_e),{size:"small",onClick:O},{default:M(()=>[...m[1]||(m[1]=[re("全选",-1)])]),_:1}),R(w(_e),{size:"small",onClick:j},{default:M(()=>[...m[2]||(m[2]=[re("取消全选",-1)])]),_:1})]),_:1})]),_:1})):be("",!0),R(w(Vt),{style:{margin:"0"}}),N("div",Ot,[E.value.length===0?(_(),me(w(_t),{key:0,description:"没有找到模型"})):(_(),$("div",jt,[(_(!0),$(De,null,Be(E.value,u=>(_(),$("div",{key:u.name,class:"group-item"},[N("div",{class:"group-header",onClick:n=>G(u.name)},[N("span",Lt,I(u.name),1),N("span",Ut,I(K(u))+"/"+I(u.models.length),1),o.multiple?(_(),$("button",{key:0,class:"group-btn",onClick:n=>K(u)===u.models.length?Q(u,n):P(u,n)},I(K(u)===u.models.length?"取消":"全选"),9,Gt)):be("",!0),N("span",Kt,I(c.value===u.name?"▲":"▼"),1)],8,Pt),c.value===u.name?(_(),$("div",Xt,[(_(!0),$(De,null,Be(u.models,n=>(_(),$("label",{key:n,class:"model-item"},[N("input",{type:"checkbox",checked:S(n),onChange:r=>X(n,r)},null,40,Yt),N("span",{class:"model-name",title:n},I(n),9,qt)]))),128))])):be("",!0)]))),128))]))])]),_:1}))}},aa=Mt(Qt,[["__scopeId","data-v-6facf375"]]);export{aa as M,ta as N};
