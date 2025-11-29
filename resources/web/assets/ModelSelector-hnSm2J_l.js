import{M as ct,ag as ut,e as q,c as i,ah as ht,ai as ft,b as z,f as ne,aj as Re,ak as vt,d as we,h as C,al as mt,am as bt,R as gt,an as pt,ao as ge,ap as wt,u as xt,n as $e,r as D,aq as kt,l as _,x as yt,m as Ct,ar as pe,as as St,q as Te,at as zt,t as le,au as ie,av as re,aw as ve,ax as I,a2 as T,a9 as $,_ as Mt,Y as me,Z as M,a3 as R,ac as be,$ as w,a0 as X,ab as Rt,a5 as se,aa as A,ay as _e,P as Tt,Q as De,az as Be,aA as Ve}from"./index-D5XyPjkW.js";import{N as _t}from"./text-CLahKoVN.js";import{N as Dt}from"./Divider-D96GdTxE.js";import{N as Bt}from"./Empty-B-I6UuOT.js";function Vt(a){const d="rgba(0, 0, 0, .85)",m="0 2px 8px 0 rgba(0, 0, 0, 0.12)",{railColor:x,primaryColor:f,baseColor:c,cardColor:k,modalColor:v,popoverColor:E,borderRadius:V,fontSize:O,opacityDisabled:j}=a;return Object.assign(Object.assign({},ut),{fontSize:O,markFontSize:O,railColor:x,railColorHover:x,fillColor:f,fillColorHover:f,opacityDisabled:j,handleColor:"#FFF",dotColor:k,dotColorModal:v,dotColorPopover:E,handleBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowHover:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowActive:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowFocus:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",indicatorColor:d,indicatorBoxShadow:m,indicatorTextColor:c,indicatorBorderRadius:V,dotBorder:`2px solid ${x}`,dotBorderActive:`2px solid ${f}`,dotBoxShadow:""})}const At={common:ct,self:Vt},It=q([i("slider",`
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
 `),q("&:hover",[i("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[ne("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),i("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),z("active",[i("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[ne("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),i("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),i("slider-marks",`
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
 `,[q("&:hover",`
 box-shadow: var(--n-handle-box-shadow-hover);
 `)]),q("&:focus",[i("slider-handle",`
 box-shadow: var(--n-handle-box-shadow-focus);
 `,[q("&:hover",`
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
 `,[Re()]),i("slider-handle-indicator",`
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
 `),Re()]),ht(i("slider",[i("slider-dot","background-color: var(--n-dot-color-modal);")])),ft(i("slider",[i("slider-dot","background-color: var(--n-dot-color-popover);")]))]);function Ae(a){return window.TouchEvent&&a instanceof window.TouchEvent}function Ie(){const a=new Map,d=m=>x=>{a.set(m,x)};return vt(()=>{a.clear()}),[a,d]}const $t=0,Nt=Object.assign(Object.assign({},$e.props),{to:ge.propTo,defaultValue:{type:[Number,Array],default:0},marks:Object,disabled:{type:Boolean,default:void 0},formatTooltip:Function,keyboard:{type:Boolean,default:!0},min:{type:Number,default:0},max:{type:Number,default:100},step:{type:[Number,String],default:1},range:Boolean,value:[Number,Array],placement:String,showTooltip:{type:Boolean,default:void 0},tooltip:{type:Boolean,default:!0},vertical:Boolean,reverse:Boolean,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onDragstart:[Function],onDragend:[Function]}),oo=we({name:"Slider",props:Nt,slots:Object,setup(a){const{mergedClsPrefixRef:d,namespaceRef:m,inlineThemeDisabled:x}=xt(a),f=$e("Slider","-slider",It,At,a,d),c=D(null),[k,v]=Ie(),[E,V]=Ie(),O=D(new Set),j=kt(a),{mergedDisabledRef:L}=j,Q=_(()=>{const{step:e}=a;if(Number(e)<=0||e==="mark")return 0;const t=e.toString();let o=0;return t.includes(".")&&(o=t.length-t.indexOf(".")-1),o}),G=D(a.defaultValue),K=yt(a,"value"),Y=Ct(K,G),S=_(()=>{const{value:e}=Y;return(a.range?e:[e]).map(Ce)}),l=_(()=>S.value.length>2),b=_(()=>a.placement===void 0?a.vertical?"right":"top":a.placement),u=_(()=>{const{marks:e}=a;return e?Object.keys(e).map(Number.parseFloat):null}),n=D(-1),s=D(-1),F=D(-1),H=D(!1),W=D(!1),de=_(()=>{const{vertical:e,reverse:t}=a;return e?t?"top":"bottom":t?"right":"left"}),Ne=_(()=>{if(l.value)return;const e=S.value,t=Z(a.range?Math.min(...e):a.min),o=Z(a.range?Math.max(...e):e[0]),{value:r}=de;return a.vertical?{[r]:`${t}%`,height:`${o-t}%`}:{[r]:`${t}%`,width:`${o-t}%`}}),Fe=_(()=>{const e=[],{marks:t}=a;if(t){const o=S.value.slice();o.sort((y,p)=>y-p);const{value:r}=de,{value:h}=l,{range:g}=a,B=h?()=>!1:y=>g?y>=o[0]&&y<=o[o.length-1]:y<=o[0];for(const y of Object.keys(t)){const p=Number(y);e.push({active:B(p),key:p,label:t[y],style:{[r]:`${Z(p)}%`}})}}return e});function He(e,t){const o=Z(e),{value:r}=de;return{[r]:`${o}%`,zIndex:t===n.value?1:0}}function xe(e){return a.showTooltip||F.value===e||n.value===e&&H.value}function Ee(e){return H.value?!(n.value===e&&s.value===e):!0}function Oe(e){var t;~e&&(n.value=e,(t=k.get(e))===null||t===void 0||t.focus())}function je(){E.forEach((e,t)=>{xe(t)&&e.syncPosition()})}function ke(e){const{"onUpdate:value":t,onUpdateValue:o}=a,{nTriggerFormInput:r,nTriggerFormChange:h}=j;o&&le(o,e),t&&le(t,e),G.value=e,r(),h()}function ye(e){const{range:t}=a;if(t){if(Array.isArray(e)){const{value:o}=S;e.join()!==o.join()&&ke(e)}}else Array.isArray(e)||S.value[0]!==e&&ke(e)}function ce(e,t){if(a.range){const o=S.value.slice();o.splice(t,1,e),ye(o)}else ye(e)}function ue(e,t,o){const r=o!==void 0;o||(o=e-t>0?1:-1);const h=u.value||[],{step:g}=a;if(g==="mark"){const p=J(e,h.concat(t),r?o:void 0);return p?p.value:t}if(g<=0)return t;const{value:B}=Q;let y;if(r){const p=Number((t/g).toFixed(B)),N=Math.floor(p),he=p>N?N:N-1,fe=p<N?N:N+1;y=J(t,[Number((he*g).toFixed(B)),Number((fe*g).toFixed(B)),...h],o)}else{const p=Pe(e);y=J(e,[...h,p])}return y?Ce(y.value):t}function Ce(e){return Math.min(a.max,Math.max(a.min,e))}function Z(e){const{max:t,min:o}=a;return(e-o)/(t-o)*100}function Le(e){const{max:t,min:o}=a;return o+(t-o)*e}function Pe(e){const{step:t,min:o}=a;if(Number(t)<=0||t==="mark")return e;const r=Math.round((e-o)/t)*t+o;return Number(r.toFixed(Q.value))}function J(e,t=u.value,o){if(!t?.length)return null;let r=null,h=-1;for(;++h<t.length;){const g=t[h]-e,B=Math.abs(g);(o===void 0||g*o>0)&&(r===null||B<r.distance)&&(r={index:h,distance:B,value:t[h]})}return r}function Se(e){const t=c.value;if(!t)return;const o=Ae(e)?e.touches[0]:e,r=t.getBoundingClientRect();let h;return a.vertical?h=(r.bottom-o.clientY)/r.height:h=(o.clientX-r.left)/r.width,a.reverse&&(h=1-h),Le(h)}function Ue(e){if(L.value||!a.keyboard)return;const{vertical:t,reverse:o}=a;switch(e.key){case"ArrowUp":e.preventDefault(),ee(t&&o?-1:1);break;case"ArrowRight":e.preventDefault(),ee(!t&&o?-1:1);break;case"ArrowDown":e.preventDefault(),ee(t&&o?1:-1);break;case"ArrowLeft":e.preventDefault(),ee(!t&&o?1:-1);break}}function ee(e){const t=n.value;if(t===-1)return;const{step:o}=a,r=S.value[t],h=Number(o)<=0||o==="mark"?r:r+o*e;ce(ue(h,r,e>0?1:-1),t)}function Ge(e){var t,o;if(L.value||!Ae(e)&&e.button!==$t)return;const r=Se(e);if(r===void 0)return;const h=S.value.slice(),g=a.range?(o=(t=J(r,h))===null||t===void 0?void 0:t.index)!==null&&o!==void 0?o:-1:0;g!==-1&&(e.preventDefault(),Oe(g),Ke(),ce(ue(r,S.value[g]),g))}function Ke(){H.value||(H.value=!0,a.onDragstart&&le(a.onDragstart),ie("touchend",document,ae),ie("mouseup",document,ae),ie("touchmove",document,oe),ie("mousemove",document,oe))}function te(){H.value&&(H.value=!1,a.onDragend&&le(a.onDragend),re("touchend",document,ae),re("mouseup",document,ae),re("touchmove",document,oe),re("mousemove",document,oe))}function oe(e){const{value:t}=n;if(!H.value||t===-1){te();return}const o=Se(e);o!==void 0&&ce(ue(o,S.value[t]),t)}function ae(){te()}function Ye(e){n.value=e,L.value||(F.value=e)}function qe(e){n.value===e&&(n.value=-1,te()),F.value===e&&(F.value=-1)}function Xe(e){F.value=e}function Qe(e){F.value===e&&(F.value=-1)}pe(n,(e,t)=>void ve(()=>s.value=t)),pe(Y,()=>{if(a.marks){if(W.value)return;W.value=!0,ve(()=>{W.value=!1})}ve(je)}),St(()=>{te()});const ze=_(()=>{const{self:{markFontSize:e,railColor:t,railColorHover:o,fillColor:r,fillColorHover:h,handleColor:g,opacityDisabled:B,dotColor:y,dotColorModal:p,handleBoxShadow:N,handleBoxShadowHover:he,handleBoxShadowActive:fe,handleBoxShadowFocus:We,dotBorder:Ze,dotBoxShadow:Je,railHeight:et,railWidthVertical:tt,handleSize:ot,dotHeight:at,dotWidth:nt,dotBorderRadius:lt,fontSize:it,dotBorderActive:rt,dotColorPopover:st},common:{cubicBezierEaseInOut:dt}}=f.value;return{"--n-bezier":dt,"--n-dot-border":Ze,"--n-dot-border-active":rt,"--n-dot-border-radius":lt,"--n-dot-box-shadow":Je,"--n-dot-color":y,"--n-dot-color-modal":p,"--n-dot-color-popover":st,"--n-dot-height":at,"--n-dot-width":nt,"--n-fill-color":r,"--n-fill-color-hover":h,"--n-font-size":it,"--n-handle-box-shadow":N,"--n-handle-box-shadow-active":fe,"--n-handle-box-shadow-focus":We,"--n-handle-box-shadow-hover":he,"--n-handle-color":g,"--n-handle-size":ot,"--n-opacity-disabled":B,"--n-rail-color":t,"--n-rail-color-hover":o,"--n-rail-height":et,"--n-rail-width-vertical":tt,"--n-mark-font-size":e}}),P=x?Te("slider",void 0,ze,a):void 0,Me=_(()=>{const{self:{fontSize:e,indicatorColor:t,indicatorBoxShadow:o,indicatorTextColor:r,indicatorBorderRadius:h}}=f.value;return{"--n-font-size":e,"--n-indicator-border-radius":h,"--n-indicator-box-shadow":o,"--n-indicator-color":t,"--n-indicator-text-color":r}}),U=x?Te("slider-indicator",void 0,Me,a):void 0;return{mergedClsPrefix:d,namespace:m,uncontrolledValue:G,mergedValue:Y,mergedDisabled:L,mergedPlacement:b,isMounted:zt(),adjustedTo:ge(a),dotTransitionDisabled:W,markInfos:Fe,isShowTooltip:xe,shouldKeepTooltipTransition:Ee,handleRailRef:c,setHandleRefs:v,setFollowerRefs:V,fillStyle:Ne,getHandleStyle:He,activeIndex:n,arrifiedValues:S,followerEnabledIndexSet:O,handleRailMouseDown:Ge,handleHandleFocus:Ye,handleHandleBlur:qe,handleHandleMouseEnter:Xe,handleHandleMouseLeave:Qe,handleRailKeyDown:Ue,indicatorCssVars:x?void 0:Me,indicatorThemeClass:U?.themeClass,indicatorOnRender:U?.onRender,cssVars:x?void 0:ze,themeClass:P?.themeClass,onRender:P?.onRender}},render(){var a;const{mergedClsPrefix:d,themeClass:m,formatTooltip:x}=this;return(a=this.onRender)===null||a===void 0||a.call(this),C("div",{class:[`${d}-slider`,m,{[`${d}-slider--disabled`]:this.mergedDisabled,[`${d}-slider--active`]:this.activeIndex!==-1,[`${d}-slider--with-mark`]:this.marks,[`${d}-slider--vertical`]:this.vertical,[`${d}-slider--reverse`]:this.reverse}],style:this.cssVars,onKeydown:this.handleRailKeyDown,onMousedown:this.handleRailMouseDown,onTouchstart:this.handleRailMouseDown},C("div",{class:`${d}-slider-rail`},C("div",{class:`${d}-slider-rail__fill`,style:this.fillStyle}),this.marks?C("div",{class:[`${d}-slider-dots`,this.dotTransitionDisabled&&`${d}-slider-dots--transition-disabled`]},this.markInfos.map(f=>C("div",{key:f.key,class:[`${d}-slider-dot`,{[`${d}-slider-dot--active`]:f.active}],style:f.style}))):null,C("div",{ref:"handleRailRef",class:`${d}-slider-handles`},this.arrifiedValues.map((f,c)=>{const k=this.isShowTooltip(c);return C(mt,null,{default:()=>[C(bt,null,{default:()=>C("div",{ref:this.setHandleRefs(c),class:`${d}-slider-handle-wrapper`,tabindex:this.mergedDisabled?-1:0,role:"slider","aria-valuenow":f,"aria-valuemin":this.min,"aria-valuemax":this.max,"aria-orientation":this.vertical?"vertical":"horizontal","aria-disabled":this.disabled,style:this.getHandleStyle(f,c),onFocus:()=>{this.handleHandleFocus(c)},onBlur:()=>{this.handleHandleBlur(c)},onMouseenter:()=>{this.handleHandleMouseEnter(c)},onMouseleave:()=>{this.handleHandleMouseLeave(c)}},gt(this.$slots.thumb,()=>[C("div",{class:`${d}-slider-handle`})]))}),this.tooltip&&C(pt,{ref:this.setFollowerRefs(c),show:k,to:this.adjustedTo,enabled:this.showTooltip&&!this.range||this.followerEnabledIndexSet.has(c),teleportDisabled:this.adjustedTo===ge.tdkey,placement:this.mergedPlacement,containerClass:this.namespace},{default:()=>C(wt,{name:"fade-in-scale-up-transition",appear:this.isMounted,css:this.shouldKeepTooltipTransition(c),onEnter:()=>{this.followerEnabledIndexSet.add(c)},onAfterLeave:()=>{this.followerEnabledIndexSet.delete(c)}},{default:()=>{var v;return k?((v=this.indicatorOnRender)===null||v===void 0||v.call(this),C("div",{class:[`${d}-slider-handle-indicator`,this.indicatorThemeClass,`${d}-slider-handle-indicator--${this.mergedPlacement}`],style:this.indicatorCssVars},typeof x=="function"?x(f):f)):null}})})]})})),this.marks?C("div",{class:`${d}-slider-marks`},this.markInfos.map(f=>C("div",{key:f.key,class:`${d}-slider-mark`,style:f.style},typeof f.label=="function"?f.label():f.label))):null))}}),Ft={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},Ht=we({name:"CheckCircleOutlined",render:function(d,m){return T(),I("svg",Ft,m[0]||(m[0]=[$("path",{d:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4l8-8z",fill:"currentColor"},null,-1)]))}}),Et={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},Ot=we({name:"SearchOutlined",render:function(d,m){return T(),I("svg",Et,m[0]||(m[0]=[$("path",{d:"M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z",fill:"currentColor"},null,-1)]))}}),jt={class:"model-list-container"},Lt={key:1,class:"group-list"},Pt=["onClick"],Ut={class:"group-name"},Gt={class:"group-count"},Kt=["onClick"],Yt={class:"expand-icon"},qt={key:0,class:"model-list"},Xt=["checked","onChange"],Qt=["title"],Wt={__name:"ModelSelector",props:{value:{type:Array,default:()=>[]},allModels:{type:Array,default:()=>[]},multiple:{type:Boolean,default:!0}},emits:["update:value"],setup(a,{emit:d}){const m=a,x=d,f=D(""),c=D(""),k=D(m.value.length);let v=new Set(m.value);pe(()=>m.value,l=>{v=new Set(l),k.value=l.length},{deep:!1});const E=_(()=>{const l={零一万物:[],OpenAI:[],Claude:[],Gemini:[],DeepSeek:[],"智谱 (GLM)":[],"Qwen (通义千问)":[],"Doubao (豆包)":[],"Mistral AI":[],Llama:[],Grok:[],"Kimi (Moonshot)":[],MiniMax:[],Cohere:[],其他:[]},b=f.value.toLowerCase();return m.allModels.filter(n=>n.toLowerCase().includes(b)).forEach(n=>{const s=n.toLowerCase();s.includes("yi-")||s.includes("零一")?l.零一万物.push(n):s.includes("gpt")||s.includes("o1")||s.includes("o3")||s.includes("davinci")?l.OpenAI.push(n):s.includes("claude")?l.Claude.push(n):s.includes("gemini")||s.includes("gemma")?l.Gemini.push(n):s.includes("deepseek")?l.DeepSeek.push(n):s.includes("glm")||s.includes("智谱")?l["智谱 (GLM)"].push(n):s.includes("qwen")||s.includes("qwq")?l["Qwen (通义千问)"].push(n):s.includes("doubao")||s.includes("豆包")?l["Doubao (豆包)"].push(n):s.includes("mistral")?l["Mistral AI"].push(n):s.includes("llama")?l.Llama.push(n):s.includes("grok")?l.Grok.push(n):s.includes("kimi")||s.includes("moonshot")?l["Kimi (Moonshot)"].push(n):s.includes("minimax")||s.includes("abab")?l.MiniMax.push(n):s.includes("cohere")||s.includes("command")?l.Cohere.push(n):l.其他.push(n)}),Object.entries(l).filter(([n,s])=>s.length>0).map(([n,s])=>({name:n,models:s}))});function V(){x("update:value",Array.from(v))}function O(){v=new Set(m.allModels),k.value=v.size,V()}function j(){v=new Set,k.value=0,V()}function L(l,b){b?.stopPropagation();for(const u of l.models)v.add(u);k.value=v.size,V(),c.value===l.name&&(c.value="",setTimeout(()=>c.value=l.name,0))}function Q(l,b){b?.stopPropagation();for(const u of l.models)v.delete(u);k.value=v.size,V(),c.value===l.name&&(c.value="",setTimeout(()=>c.value=l.name,0))}function G(l){c.value=c.value===l?"":l}function K(l){let b=0;for(const u of l.models)v.has(u)&&b++;return b}function Y(l,b){v.has(l)?v.delete(l):v.add(l),k.value=v.size,V()}function S(l){return v.has(l)}return(l,b)=>(T(),me(w(X),{vertical:"",size:16},{default:M(()=>[R(w(X),{justify:"space-between",align:"center"},{default:M(()=>[R(w(X),{size:8},{default:M(()=>[R(w(Rt),{type:"success",bordered:!1,size:"medium"},{icon:M(()=>[R(w(_e),null,{default:M(()=>[R(w(Ht))]),_:1})]),default:M(()=>[se(" 已选择 ("+A(k.value)+") ",1)]),_:1})]),_:1})]),_:1}),R(w(Tt),{value:f.value,"onUpdate:value":b[0]||(b[0]=u=>f.value=u),placeholder:"搜索模型",clearable:"",size:"large"},{prefix:M(()=>[R(w(_e),null,{default:M(()=>[R(w(Ot))]),_:1})]),_:1},8,["value"]),a.multiple?(T(),me(w(X),{key:0,justify:"space-between",align:"center"},{default:M(()=>[R(w(_t),{depth:"3"},{default:M(()=>[se(" 已选择 "+A(k.value)+" / "+A(a.allModels.length),1)]),_:1}),R(w(X),{size:8},{default:M(()=>[R(w(De),{size:"small",onClick:O},{default:M(()=>[...b[1]||(b[1]=[se("全选",-1)])]),_:1}),R(w(De),{size:"small",onClick:j},{default:M(()=>[...b[2]||(b[2]=[se("取消全选",-1)])]),_:1})]),_:1})]),_:1})):be("",!0),R(w(Dt),{style:{margin:"0"}}),$("div",jt,[E.value.length===0?(T(),me(w(Bt),{key:0,description:"没有找到模型"})):(T(),I("div",Lt,[(T(!0),I(Be,null,Ve(E.value,u=>(T(),I("div",{key:u.name,class:"group-item"},[$("div",{class:"group-header",onClick:n=>G(u.name)},[$("span",Ut,A(u.name),1),$("span",Gt,A(K(u))+"/"+A(u.models.length),1),a.multiple?(T(),I("button",{key:0,class:"group-btn",onClick:n=>K(u)===u.models.length?Q(u,n):L(u,n)},A(K(u)===u.models.length?"取消":"全选"),9,Kt)):be("",!0),$("span",Yt,A(c.value===u.name?"▲":"▼"),1)],8,Pt),c.value===u.name?(T(),I("div",qt,[(T(!0),I(Be,null,Ve(u.models,n=>(T(),I("label",{key:n,class:"model-item"},[$("input",{type:"checkbox",checked:S(n),onChange:s=>Y(n,s)},null,40,Xt),$("span",{class:"model-name",title:n},A(n),9,Qt)]))),128))])):be("",!0)]))),128))]))])]),_:1}))}},ao=Mt(Wt,[["__scopeId","data-v-6facf375"]]);export{ao as M,oo as N};
