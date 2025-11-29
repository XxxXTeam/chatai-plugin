import{M as ct,ag as ut,e as U,c as s,ah as ht,ai as ft,b as z,f as ae,aj as Re,ak as vt,d as we,h as C,al as mt,am as bt,R as gt,an as pt,ao as pe,ap as wt,u as xt,n as Ie,r as D,aq as kt,l as T,x as yt,m as Ct,ar as ie,as as St,q as Te,at as zt,t as oe,au as ne,av as le,aw as me,ax as V,a2 as B,a9 as A,_ as Mt,Y as be,Z as M,a3 as R,ac as ge,$ as x,a0 as K,ab as Rt,a5 as se,aa as I,ay as Be,P as Tt,Q as De,az as _e,aA as Ve,af as Bt,aB as Dt}from"./index-CRg1HdVx.js";import{N as _t}from"./text-DAbFSmry.js";import{N as Vt}from"./Divider-BMulYv-W.js";import{N as At}from"./Empty-DAAIJU8L.js";function $t(o){const u="rgba(0, 0, 0, .85)",g="0 2px 8px 0 rgba(0, 0, 0, 0.12)",{railColor:k,primaryColor:f,baseColor:v,cardColor:m,modalColor:b,popoverColor:N,borderRadius:P,fontSize:F,opacityDisabled:H}=o;return Object.assign(Object.assign({},ut),{fontSize:F,markFontSize:F,railColor:k,railColorHover:k,fillColor:f,fillColorHover:f,opacityDisabled:H,handleColor:"#FFF",dotColor:m,dotColorModal:b,dotColorPopover:N,handleBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowHover:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowActive:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowFocus:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",indicatorColor:u,indicatorBoxShadow:g,indicatorTextColor:v,indicatorBorderRadius:P,dotBorder:`2px solid ${k}`,dotBorderActive:`2px solid ${f}`,dotBoxShadow:""})}const It={common:ct,self:$t},Ft=U([s("slider",`
 display: block;
 padding: calc((var(--n-handle-size) - var(--n-rail-height)) / 2) 0;
 position: relative;
 z-index: 0;
 width: 100%;
 cursor: pointer;
 user-select: none;
 -webkit-user-select: none;
 `,[z("reverse",[s("slider-handles",[s("slider-handle-wrapper",`
 transform: translate(50%, -50%);
 `)]),s("slider-dots",[s("slider-dot",`
 transform: translateX(50%, -50%);
 `)]),z("vertical",[s("slider-handles",[s("slider-handle-wrapper",`
 transform: translate(-50%, -50%);
 `)]),s("slider-marks",[s("slider-mark",`
 transform: translateY(calc(-50% + var(--n-dot-height) / 2));
 `)]),s("slider-dots",[s("slider-dot",`
 transform: translateX(-50%) translateY(0);
 `)])])]),z("vertical",`
 box-sizing: content-box;
 padding: 0 calc((var(--n-handle-size) - var(--n-rail-height)) / 2);
 width: var(--n-rail-width-vertical);
 height: 100%;
 `,[s("slider-handles",`
 top: calc(var(--n-handle-size) / 2);
 right: 0;
 bottom: calc(var(--n-handle-size) / 2);
 left: 0;
 `,[s("slider-handle-wrapper",`
 top: unset;
 left: 50%;
 transform: translate(-50%, 50%);
 `)]),s("slider-rail",`
 height: 100%;
 `,[ae("fill",`
 top: unset;
 right: 0;
 bottom: unset;
 left: 0;
 `)]),z("with-mark",`
 width: var(--n-rail-width-vertical);
 margin: 0 32px 0 8px;
 `),s("slider-marks",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 22px;
 font-size: var(--n-mark-font-size);
 `,[s("slider-mark",`
 transform: translateY(50%);
 white-space: nowrap;
 `)]),s("slider-dots",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 50%;
 `,[s("slider-dot",`
 transform: translateX(-50%) translateY(50%);
 `)])]),z("disabled",`
 cursor: not-allowed;
 opacity: var(--n-opacity-disabled);
 `,[s("slider-handle",`
 cursor: not-allowed;
 `)]),z("with-mark",`
 width: 100%;
 margin: 8px 0 32px 0;
 `),U("&:hover",[s("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[ae("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),s("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),z("active",[s("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[ae("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),s("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),s("slider-marks",`
 position: absolute;
 top: 18px;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[s("slider-mark",`
 position: absolute;
 transform: translateX(-50%);
 white-space: nowrap;
 `)]),s("slider-rail",`
 width: 100%;
 position: relative;
 height: var(--n-rail-height);
 background-color: var(--n-rail-color);
 transition: background-color .3s var(--n-bezier);
 border-radius: calc(var(--n-rail-height) / 2);
 `,[ae("fill",`
 position: absolute;
 top: 0;
 bottom: 0;
 border-radius: calc(var(--n-rail-height) / 2);
 transition: background-color .3s var(--n-bezier);
 background-color: var(--n-fill-color);
 `)]),s("slider-handles",`
 position: absolute;
 top: 0;
 right: calc(var(--n-handle-size) / 2);
 bottom: 0;
 left: calc(var(--n-handle-size) / 2);
 `,[s("slider-handle-wrapper",`
 outline: none;
 position: absolute;
 top: 50%;
 transform: translate(-50%, -50%);
 cursor: pointer;
 display: flex;
 `,[s("slider-handle",`
 height: var(--n-handle-size);
 width: var(--n-handle-size);
 border-radius: 50%;
 overflow: hidden;
 transition: box-shadow .2s var(--n-bezier), background-color .3s var(--n-bezier);
 background-color: var(--n-handle-color);
 box-shadow: var(--n-handle-box-shadow);
 `,[U("&:hover",`
 box-shadow: var(--n-handle-box-shadow-hover);
 `)]),U("&:focus",[s("slider-handle",`
 box-shadow: var(--n-handle-box-shadow-focus);
 `,[U("&:hover",`
 box-shadow: var(--n-handle-box-shadow-active);
 `)])])])]),s("slider-dots",`
 position: absolute;
 top: 50%;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[z("transition-disabled",[s("slider-dot","transition: none;")]),s("slider-dot",`
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
 `,[z("active","border: var(--n-dot-border-active);")])])]),s("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[Re()]),s("slider-handle-indicator",`
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
 `),Re()]),ht(s("slider",[s("slider-dot","background-color: var(--n-dot-color-modal);")])),ft(s("slider",[s("slider-dot","background-color: var(--n-dot-color-popover);")]))]);function Ae(o){return window.TouchEvent&&o instanceof window.TouchEvent}function $e(){const o=new Map,u=g=>k=>{o.set(g,k)};return vt(()=>{o.clear()}),[o,u]}const Nt=0,Ht=Object.assign(Object.assign({},Ie.props),{to:pe.propTo,defaultValue:{type:[Number,Array],default:0},marks:Object,disabled:{type:Boolean,default:void 0},formatTooltip:Function,keyboard:{type:Boolean,default:!0},min:{type:Number,default:0},max:{type:Number,default:100},step:{type:[Number,String],default:1},range:Boolean,value:[Number,Array],placement:String,showTooltip:{type:Boolean,default:void 0},tooltip:{type:Boolean,default:!0},vertical:Boolean,reverse:Boolean,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onDragstart:[Function],onDragend:[Function]}),oa=we({name:"Slider",props:Ht,slots:Object,setup(o){const{mergedClsPrefixRef:u,namespaceRef:g,inlineThemeDisabled:k}=xt(o),f=Ie("Slider","-slider",Ft,It,o,u),v=D(null),[m,b]=$e(),[N,P]=$e(),F=D(new Set),H=kt(o),{mergedDisabledRef:E}=H,Y=T(()=>{const{step:e}=o;if(Number(e)<=0||e==="mark")return 0;const t=e.toString();let a=0;return t.includes(".")&&(a=t.length-t.indexOf(".")-1),a}),G=D(o.defaultValue),re=yt(o,"value"),O=Ct(re,G),S=T(()=>{const{value:e}=O;return(o.range?e:[e]).map(Ce)}),q=T(()=>S.value.length>2),de=T(()=>o.placement===void 0?o.vertical?"right":"top":o.placement),X=T(()=>{const{marks:e}=o;return e?Object.keys(e).map(Number.parseFloat):null}),n=D(-1),c=D(-1),i=D(-1),l=D(!1),d=D(!1),ce=T(()=>{const{vertical:e,reverse:t}=o;return e?t?"top":"bottom":t?"right":"left"}),Fe=T(()=>{if(q.value)return;const e=S.value,t=Q(o.range?Math.min(...e):o.min),a=Q(o.range?Math.max(...e):e[0]),{value:r}=ce;return o.vertical?{[r]:`${t}%`,height:`${a-t}%`}:{[r]:`${t}%`,width:`${a-t}%`}}),Ne=T(()=>{const e=[],{marks:t}=o;if(t){const a=S.value.slice();a.sort((y,w)=>y-w);const{value:r}=ce,{value:h}=q,{range:p}=o,_=h?()=>!1:y=>p?y>=a[0]&&y<=a[a.length-1]:y<=a[0];for(const y of Object.keys(t)){const w=Number(y);e.push({active:_(w),key:w,label:t[y],style:{[r]:`${Q(w)}%`}})}}return e});function He(e,t){const a=Q(e),{value:r}=ce;return{[r]:`${a}%`,zIndex:t===n.value?1:0}}function xe(e){return o.showTooltip||i.value===e||n.value===e&&l.value}function Ee(e){return l.value?!(n.value===e&&c.value===e):!0}function Oe(e){var t;~e&&(n.value=e,(t=m.get(e))===null||t===void 0||t.focus())}function je(){N.forEach((e,t)=>{xe(t)&&e.syncPosition()})}function ke(e){const{"onUpdate:value":t,onUpdateValue:a}=o,{nTriggerFormInput:r,nTriggerFormChange:h}=H;a&&oe(a,e),t&&oe(t,e),G.value=e,r(),h()}function ye(e){const{range:t}=o;if(t){if(Array.isArray(e)){const{value:a}=S;e.join()!==a.join()&&ke(e)}}else Array.isArray(e)||S.value[0]!==e&&ke(e)}function ue(e,t){if(o.range){const a=S.value.slice();a.splice(t,1,e),ye(a)}else ye(e)}function he(e,t,a){const r=a!==void 0;a||(a=e-t>0?1:-1);const h=X.value||[],{step:p}=o;if(p==="mark"){const w=W(e,h.concat(t),r?a:void 0);return w?w.value:t}if(p<=0)return t;const{value:_}=Y;let y;if(r){const w=Number((t/p).toFixed(_)),$=Math.floor(w),fe=w>$?$:$-1,ve=w<$?$:$+1;y=W(t,[Number((fe*p).toFixed(_)),Number((ve*p).toFixed(_)),...h],a)}else{const w=Pe(e);y=W(e,[...h,w])}return y?Ce(y.value):t}function Ce(e){return Math.min(o.max,Math.max(o.min,e))}function Q(e){const{max:t,min:a}=o;return(e-a)/(t-a)*100}function Le(e){const{max:t,min:a}=o;return a+(t-a)*e}function Pe(e){const{step:t,min:a}=o;if(Number(t)<=0||t==="mark")return e;const r=Math.round((e-a)/t)*t+a;return Number(r.toFixed(Y.value))}function W(e,t=X.value,a){if(!t?.length)return null;let r=null,h=-1;for(;++h<t.length;){const p=t[h]-e,_=Math.abs(p);(a===void 0||p*a>0)&&(r===null||_<r.distance)&&(r={index:h,distance:_,value:t[h]})}return r}function Se(e){const t=v.value;if(!t)return;const a=Ae(e)?e.touches[0]:e,r=t.getBoundingClientRect();let h;return o.vertical?h=(r.bottom-a.clientY)/r.height:h=(a.clientX-r.left)/r.width,o.reverse&&(h=1-h),Le(h)}function Ge(e){if(E.value||!o.keyboard)return;const{vertical:t,reverse:a}=o;switch(e.key){case"ArrowUp":e.preventDefault(),Z(t&&a?-1:1);break;case"ArrowRight":e.preventDefault(),Z(!t&&a?-1:1);break;case"ArrowDown":e.preventDefault(),Z(t&&a?1:-1);break;case"ArrowLeft":e.preventDefault(),Z(!t&&a?1:-1);break}}function Z(e){const t=n.value;if(t===-1)return;const{step:a}=o,r=S.value[t],h=Number(a)<=0||a==="mark"?r:r+a*e;ue(he(h,r,e>0?1:-1),t)}function Ue(e){var t,a;if(E.value||!Ae(e)&&e.button!==Nt)return;const r=Se(e);if(r===void 0)return;const h=S.value.slice(),p=o.range?(a=(t=W(r,h))===null||t===void 0?void 0:t.index)!==null&&a!==void 0?a:-1:0;p!==-1&&(e.preventDefault(),Oe(p),Ke(),ue(he(r,S.value[p]),p))}function Ke(){l.value||(l.value=!0,o.onDragstart&&oe(o.onDragstart),ne("touchend",document,te),ne("mouseup",document,te),ne("touchmove",document,ee),ne("mousemove",document,ee))}function J(){l.value&&(l.value=!1,o.onDragend&&oe(o.onDragend),le("touchend",document,te),le("mouseup",document,te),le("touchmove",document,ee),le("mousemove",document,ee))}function ee(e){const{value:t}=n;if(!l.value||t===-1){J();return}const a=Se(e);a!==void 0&&ue(he(a,S.value[t]),t)}function te(){J()}function Ye(e){n.value=e,E.value||(i.value=e)}function qe(e){n.value===e&&(n.value=-1,J()),i.value===e&&(i.value=-1)}function Xe(e){i.value=e}function Qe(e){i.value===e&&(i.value=-1)}ie(n,(e,t)=>void me(()=>c.value=t)),ie(O,()=>{if(o.marks){if(d.value)return;d.value=!0,me(()=>{d.value=!1})}me(je)}),St(()=>{J()});const ze=T(()=>{const{self:{markFontSize:e,railColor:t,railColorHover:a,fillColor:r,fillColorHover:h,handleColor:p,opacityDisabled:_,dotColor:y,dotColorModal:w,handleBoxShadow:$,handleBoxShadowHover:fe,handleBoxShadowActive:ve,handleBoxShadowFocus:We,dotBorder:Ze,dotBoxShadow:Je,railHeight:et,railWidthVertical:tt,handleSize:at,dotHeight:ot,dotWidth:nt,dotBorderRadius:lt,fontSize:st,dotBorderActive:it,dotColorPopover:rt},common:{cubicBezierEaseInOut:dt}}=f.value;return{"--n-bezier":dt,"--n-dot-border":Ze,"--n-dot-border-active":it,"--n-dot-border-radius":lt,"--n-dot-box-shadow":Je,"--n-dot-color":y,"--n-dot-color-modal":w,"--n-dot-color-popover":rt,"--n-dot-height":ot,"--n-dot-width":nt,"--n-fill-color":r,"--n-fill-color-hover":h,"--n-font-size":st,"--n-handle-box-shadow":$,"--n-handle-box-shadow-active":ve,"--n-handle-box-shadow-focus":We,"--n-handle-box-shadow-hover":fe,"--n-handle-color":p,"--n-handle-size":at,"--n-opacity-disabled":_,"--n-rail-color":t,"--n-rail-color-hover":a,"--n-rail-height":et,"--n-rail-width-vertical":tt,"--n-mark-font-size":e}}),j=k?Te("slider",void 0,ze,o):void 0,Me=T(()=>{const{self:{fontSize:e,indicatorColor:t,indicatorBoxShadow:a,indicatorTextColor:r,indicatorBorderRadius:h}}=f.value;return{"--n-font-size":e,"--n-indicator-border-radius":h,"--n-indicator-box-shadow":a,"--n-indicator-color":t,"--n-indicator-text-color":r}}),L=k?Te("slider-indicator",void 0,Me,o):void 0;return{mergedClsPrefix:u,namespace:g,uncontrolledValue:G,mergedValue:O,mergedDisabled:E,mergedPlacement:de,isMounted:zt(),adjustedTo:pe(o),dotTransitionDisabled:d,markInfos:Ne,isShowTooltip:xe,shouldKeepTooltipTransition:Ee,handleRailRef:v,setHandleRefs:b,setFollowerRefs:P,fillStyle:Fe,getHandleStyle:He,activeIndex:n,arrifiedValues:S,followerEnabledIndexSet:F,handleRailMouseDown:Ue,handleHandleFocus:Ye,handleHandleBlur:qe,handleHandleMouseEnter:Xe,handleHandleMouseLeave:Qe,handleRailKeyDown:Ge,indicatorCssVars:k?void 0:Me,indicatorThemeClass:L?.themeClass,indicatorOnRender:L?.onRender,cssVars:k?void 0:ze,themeClass:j?.themeClass,onRender:j?.onRender}},render(){var o;const{mergedClsPrefix:u,themeClass:g,formatTooltip:k}=this;return(o=this.onRender)===null||o===void 0||o.call(this),C("div",{class:[`${u}-slider`,g,{[`${u}-slider--disabled`]:this.mergedDisabled,[`${u}-slider--active`]:this.activeIndex!==-1,[`${u}-slider--with-mark`]:this.marks,[`${u}-slider--vertical`]:this.vertical,[`${u}-slider--reverse`]:this.reverse}],style:this.cssVars,onKeydown:this.handleRailKeyDown,onMousedown:this.handleRailMouseDown,onTouchstart:this.handleRailMouseDown},C("div",{class:`${u}-slider-rail`},C("div",{class:`${u}-slider-rail__fill`,style:this.fillStyle}),this.marks?C("div",{class:[`${u}-slider-dots`,this.dotTransitionDisabled&&`${u}-slider-dots--transition-disabled`]},this.markInfos.map(f=>C("div",{key:f.key,class:[`${u}-slider-dot`,{[`${u}-slider-dot--active`]:f.active}],style:f.style}))):null,C("div",{ref:"handleRailRef",class:`${u}-slider-handles`},this.arrifiedValues.map((f,v)=>{const m=this.isShowTooltip(v);return C(mt,null,{default:()=>[C(bt,null,{default:()=>C("div",{ref:this.setHandleRefs(v),class:`${u}-slider-handle-wrapper`,tabindex:this.mergedDisabled?-1:0,role:"slider","aria-valuenow":f,"aria-valuemin":this.min,"aria-valuemax":this.max,"aria-orientation":this.vertical?"vertical":"horizontal","aria-disabled":this.disabled,style:this.getHandleStyle(f,v),onFocus:()=>{this.handleHandleFocus(v)},onBlur:()=>{this.handleHandleBlur(v)},onMouseenter:()=>{this.handleHandleMouseEnter(v)},onMouseleave:()=>{this.handleHandleMouseLeave(v)}},gt(this.$slots.thumb,()=>[C("div",{class:`${u}-slider-handle`})]))}),this.tooltip&&C(pt,{ref:this.setFollowerRefs(v),show:m,to:this.adjustedTo,enabled:this.showTooltip&&!this.range||this.followerEnabledIndexSet.has(v),teleportDisabled:this.adjustedTo===pe.tdkey,placement:this.mergedPlacement,containerClass:this.namespace},{default:()=>C(wt,{name:"fade-in-scale-up-transition",appear:this.isMounted,css:this.shouldKeepTooltipTransition(v),onEnter:()=>{this.followerEnabledIndexSet.add(v)},onAfterLeave:()=>{this.followerEnabledIndexSet.delete(v)}},{default:()=>{var b;return m?((b=this.indicatorOnRender)===null||b===void 0||b.call(this),C("div",{class:[`${u}-slider-handle-indicator`,this.indicatorThemeClass,`${u}-slider-handle-indicator--${this.mergedPlacement}`],style:this.indicatorCssVars},typeof k=="function"?k(f):f)):null}})})]})})),this.marks?C("div",{class:`${u}-slider-marks`},this.markInfos.map(f=>C("div",{key:f.key,class:`${u}-slider-mark`,style:f.style},typeof f.label=="function"?f.label():f.label))):null))}}),Et={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},Ot=we({name:"CheckCircleOutlined",render:function(u,g){return B(),V("svg",Et,g[0]||(g[0]=[A("path",{d:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4l8-8z",fill:"currentColor"},null,-1)]))}}),jt={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},Lt=we({name:"SearchOutlined",render:function(u,g){return B(),V("svg",jt,g[0]||(g[0]=[A("path",{d:"M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z",fill:"currentColor"},null,-1)]))}}),Pt={class:"model-list-container"},Gt={key:1,class:"group-list"},Ut=["onClick"],Kt=["checked","indeterminate","onChange"],Yt={class:"group-name"},qt={class:"expand-icon"},Xt={key:0,class:"model-list"},Qt=["checked","onChange"],Wt=["title"],Zt={__name:"ModelSelector",props:{value:{type:Array,default:()=>[]},allModels:{type:Array,default:()=>[]},multiple:{type:Boolean,default:!0}},emits:["update:value"],setup(o,{emit:u}){const g=o,k=u,f=D(""),v=D(new Set),m=D(new Set(g.value)),b=D(0),N=T(()=>(b.value,m.value.size)),P=T(()=>Array.from(m.value));ie(()=>g.value,n=>{m.value=new Set(n),b.value++},{deep:!1}),ie(P,n=>{k("update:value",n)},{deep:!1});const F=T(()=>{const n={零一万物:[],OpenAI:[],Claude:[],Gemini:[],DeepSeek:[],"智谱 (GLM)":[],"Qwen (通义千问)":[],"Doubao (豆包)":[],"Mistral AI":[],Llama:[],Grok:[],"Kimi (Moonshot)":[],MiniMax:[],Cohere:[],其他:[]},c=f.value.toLowerCase();return g.allModels.filter(l=>l.toLowerCase().includes(c)).forEach(l=>{const d=l.toLowerCase();d.includes("yi-")||d.includes("零一")?n.零一万物.push(l):d.includes("gpt")||d.includes("o1")||d.includes("o3")||d.includes("davinci")?n.OpenAI.push(l):d.includes("claude")?n.Claude.push(l):d.includes("gemini")||d.includes("gemma")?n.Gemini.push(l):d.includes("deepseek")?n.DeepSeek.push(l):d.includes("glm")||d.includes("智谱")?n["智谱 (GLM)"].push(l):d.includes("qwen")||d.includes("qwq")?n["Qwen (通义千问)"].push(l):d.includes("doubao")||d.includes("豆包")?n["Doubao (豆包)"].push(l):d.includes("mistral")?n["Mistral AI"].push(l):d.includes("llama")?n.Llama.push(l):d.includes("grok")?n.Grok.push(l):d.includes("kimi")||d.includes("moonshot")?n["Kimi (Moonshot)"].push(l):d.includes("minimax")||d.includes("abab")?n.MiniMax.push(l):d.includes("cohere")||d.includes("command")?n.Cohere.push(l):n.其他.push(l)}),Object.entries(n).filter(([l,d])=>d.length>0).map(([l,d])=>({name:l,models:d}))});function H(){m.value=new Set(g.allModels),b.value++}function E(){m.value=new Set,b.value++}function Y(n){const c=m.value;for(const i of n.models)c.add(i);b.value++}function G(n){const c=m.value;for(const i of n.models)c.delete(i);b.value++}function re(n){const c=v.value;c.has(n)?c.delete(n):c.add(n),v.value=new Set(c)}function O(n){b.value;const c=m.value;return n.models.length>0&&n.models.every(i=>c.has(i))}function S(n){b.value;const c=m.value;let i=0;for(const l of n.models)c.has(l)&&i++;return i>0&&i<n.models.length}function q(n){b.value;const c=m.value;let i=0;for(const l of n.models)c.has(l)&&i++;return i}function de(n){const c=m.value;if(!g.multiple){m.value=c.has(n)?new Set:new Set([n]),b.value++;return}c.has(n)?c.delete(n):c.add(n),b.value++}function X(n){return b.value,m.value.has(n)}return(n,c)=>(B(),be(x(K),{vertical:"",size:16},{default:M(()=>[R(x(K),{justify:"space-between",align:"center"},{default:M(()=>[R(x(K),{size:8},{default:M(()=>[R(x(Rt),{type:"success",bordered:!1,size:"medium"},{icon:M(()=>[R(x(Be),null,{default:M(()=>[R(x(Ot))]),_:1})]),default:M(()=>[se(" 已选择 ("+I(N.value)+") ",1)]),_:1})]),_:1})]),_:1}),R(x(Tt),{value:f.value,"onUpdate:value":c[0]||(c[0]=i=>f.value=i),placeholder:"搜索模型",clearable:"",size:"large"},{prefix:M(()=>[R(x(Be),null,{default:M(()=>[R(x(Lt))]),_:1})]),_:1},8,["value"]),o.multiple?(B(),be(x(K),{key:0,justify:"space-between",align:"center"},{default:M(()=>[R(x(_t),{depth:"3"},{default:M(()=>[se(" 已选择 "+I(N.value)+" / "+I(o.allModels.length),1)]),_:1}),R(x(K),{size:8},{default:M(()=>[R(x(De),{size:"small",onClick:H},{default:M(()=>[...c[2]||(c[2]=[se("全选",-1)])]),_:1}),R(x(De),{size:"small",onClick:E},{default:M(()=>[...c[3]||(c[3]=[se("取消全选",-1)])]),_:1})]),_:1})]),_:1})):ge("",!0),R(x(Vt),{style:{margin:"0"}}),A("div",Pt,[F.value.length===0?(B(),be(x(At),{key:0,description:"没有找到模型"})):(B(),V("div",Gt,[(B(!0),V(_e,null,Ve(F.value,i=>(B(),V("div",{key:i.name,class:"group-item"},[A("div",{class:"group-header",onClick:l=>re(i.name)},[o.multiple?(B(),V("input",{key:0,type:"checkbox",checked:O(i),indeterminate:S(i),onClick:c[1]||(c[1]=Bt(()=>{},["stop"])),onChange:l=>l.target.checked?Y(i):G(i),class:"group-checkbox"},null,40,Kt)):ge("",!0),A("span",Yt,I(i.name),1),A("span",{class:Dt(["group-count",{selected:O(i)}])},I(q(i))+"/"+I(i.models.length),3),A("span",qt,I(v.value.has(i.name)?"▲":"▼"),1)],8,Ut),v.value.has(i.name)?(B(),V("div",Xt,[(B(!0),V(_e,null,Ve(i.models,l=>(B(),V("label",{key:l,class:"model-item"},[A("input",{type:"checkbox",checked:X(l),onChange:d=>de(l)},null,40,Qt),A("span",{class:"model-name",title:l},I(l),9,Wt)]))),128))])):ge("",!0)]))),128))]))])]),_:1}))}},na=Mt(Zt,[["__scopeId","data-v-2642348b"]]);export{na as M,oa as N};
