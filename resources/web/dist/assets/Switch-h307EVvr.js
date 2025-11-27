import{n as Ae,a9 as st,aa as dt,ab as ct,e as O,c as n,ac as ut,ad as ht,b,f as d,ae as Fe,af as ft,d as Ne,h as c,ag as vt,ah as bt,t as gt,ai as mt,aj as Be,ak as wt,u as je,z as ve,w as D,P as Pe,A as k,x as Ee,y as Oe,al as De,am as pt,C as $e,an as xt,I as L,ao as he,ap as fe,Q as Re,a as Me,aq as _e,ar as Se,r as U,as as yt,at as kt,au as K,av as ze,aw as I}from"./index-BPZ3RAI7.js";function Ct(t){const i="rgba(0, 0, 0, .85)",w="0 2px 8px 0 rgba(0, 0, 0, 0.12)",{railColor:h,primaryColor:l,baseColor:f,cardColor:x,modalColor:C,popoverColor:A,borderRadius:$,fontSize:M,opacityDisabled:V}=t;return Object.assign(Object.assign({},st),{fontSize:M,markFontSize:M,railColor:h,railColorHover:h,fillColor:l,fillColorHover:l,opacityDisabled:V,handleColor:"#FFF",dotColor:x,dotColorModal:C,dotColorPopover:A,handleBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowHover:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowActive:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowFocus:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",indicatorColor:i,indicatorBoxShadow:w,indicatorTextColor:f,indicatorBorderRadius:$,dotBorder:`2px solid ${h}`,dotBorderActive:`2px solid ${l}`,dotBoxShadow:""})}const Rt={common:Ae,self:Ct};function St(t){const{primaryColor:i,opacityDisabled:w,borderRadius:h,textColor3:l}=t;return Object.assign(Object.assign({},dt),{iconColor:l,textColor:"white",loadingColor:i,opacityDisabled:w,railColor:"rgba(0, 0, 0, .14)",railColorActive:i,buttonBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",buttonColor:"#FFF",railBorderRadiusSmall:h,railBorderRadiusMedium:h,railBorderRadiusLarge:h,buttonBorderRadiusSmall:h,buttonBorderRadiusMedium:h,buttonBorderRadiusLarge:h,boxShadowFocus:`0 0 0 2px ${ct(i,{alpha:.2})}`})}const zt={common:Ae,self:St},Bt=O([n("slider",`
 display: block;
 padding: calc((var(--n-handle-size) - var(--n-rail-height)) / 2) 0;
 position: relative;
 z-index: 0;
 width: 100%;
 cursor: pointer;
 user-select: none;
 -webkit-user-select: none;
 `,[b("reverse",[n("slider-handles",[n("slider-handle-wrapper",`
 transform: translate(50%, -50%);
 `)]),n("slider-dots",[n("slider-dot",`
 transform: translateX(50%, -50%);
 `)]),b("vertical",[n("slider-handles",[n("slider-handle-wrapper",`
 transform: translate(-50%, -50%);
 `)]),n("slider-marks",[n("slider-mark",`
 transform: translateY(calc(-50% + var(--n-dot-height) / 2));
 `)]),n("slider-dots",[n("slider-dot",`
 transform: translateX(-50%) translateY(0);
 `)])])]),b("vertical",`
 box-sizing: content-box;
 padding: 0 calc((var(--n-handle-size) - var(--n-rail-height)) / 2);
 width: var(--n-rail-width-vertical);
 height: 100%;
 `,[n("slider-handles",`
 top: calc(var(--n-handle-size) / 2);
 right: 0;
 bottom: calc(var(--n-handle-size) / 2);
 left: 0;
 `,[n("slider-handle-wrapper",`
 top: unset;
 left: 50%;
 transform: translate(-50%, 50%);
 `)]),n("slider-rail",`
 height: 100%;
 `,[d("fill",`
 top: unset;
 right: 0;
 bottom: unset;
 left: 0;
 `)]),b("with-mark",`
 width: var(--n-rail-width-vertical);
 margin: 0 32px 0 8px;
 `),n("slider-marks",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 22px;
 font-size: var(--n-mark-font-size);
 `,[n("slider-mark",`
 transform: translateY(50%);
 white-space: nowrap;
 `)]),n("slider-dots",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 50%;
 `,[n("slider-dot",`
 transform: translateX(-50%) translateY(50%);
 `)])]),b("disabled",`
 cursor: not-allowed;
 opacity: var(--n-opacity-disabled);
 `,[n("slider-handle",`
 cursor: not-allowed;
 `)]),b("with-mark",`
 width: 100%;
 margin: 8px 0 32px 0;
 `),O("&:hover",[n("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[d("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),n("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),b("active",[n("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[d("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),n("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),n("slider-marks",`
 position: absolute;
 top: 18px;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[n("slider-mark",`
 position: absolute;
 transform: translateX(-50%);
 white-space: nowrap;
 `)]),n("slider-rail",`
 width: 100%;
 position: relative;
 height: var(--n-rail-height);
 background-color: var(--n-rail-color);
 transition: background-color .3s var(--n-bezier);
 border-radius: calc(var(--n-rail-height) / 2);
 `,[d("fill",`
 position: absolute;
 top: 0;
 bottom: 0;
 border-radius: calc(var(--n-rail-height) / 2);
 transition: background-color .3s var(--n-bezier);
 background-color: var(--n-fill-color);
 `)]),n("slider-handles",`
 position: absolute;
 top: 0;
 right: calc(var(--n-handle-size) / 2);
 bottom: 0;
 left: calc(var(--n-handle-size) / 2);
 `,[n("slider-handle-wrapper",`
 outline: none;
 position: absolute;
 top: 50%;
 transform: translate(-50%, -50%);
 cursor: pointer;
 display: flex;
 `,[n("slider-handle",`
 height: var(--n-handle-size);
 width: var(--n-handle-size);
 border-radius: 50%;
 overflow: hidden;
 transition: box-shadow .2s var(--n-bezier), background-color .3s var(--n-bezier);
 background-color: var(--n-handle-color);
 box-shadow: var(--n-handle-box-shadow);
 `,[O("&:hover",`
 box-shadow: var(--n-handle-box-shadow-hover);
 `)]),O("&:focus",[n("slider-handle",`
 box-shadow: var(--n-handle-box-shadow-focus);
 `,[O("&:hover",`
 box-shadow: var(--n-handle-box-shadow-active);
 `)])])])]),n("slider-dots",`
 position: absolute;
 top: 50%;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[b("transition-disabled",[n("slider-dot","transition: none;")]),n("slider-dot",`
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
 `,[b("active","border: var(--n-dot-border-active);")])])]),n("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[Fe()]),n("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[b("top",`
 margin-bottom: 12px;
 `),b("right",`
 margin-left: 12px;
 `),b("bottom",`
 margin-top: 12px;
 `),b("left",`
 margin-right: 12px;
 `),Fe()]),ut(n("slider",[n("slider-dot","background-color: var(--n-dot-color-modal);")])),ht(n("slider",[n("slider-dot","background-color: var(--n-dot-color-popover);")]))]);function He(t){return window.TouchEvent&&t instanceof window.TouchEvent}function Ie(){const t=new Map,i=w=>h=>{t.set(w,h)};return ft(()=>{t.clear()}),[t,i]}const $t=0,Vt=Object.assign(Object.assign({},ve.props),{to:Be.propTo,defaultValue:{type:[Number,Array],default:0},marks:Object,disabled:{type:Boolean,default:void 0},formatTooltip:Function,keyboard:{type:Boolean,default:!0},min:{type:Number,default:0},max:{type:Number,default:100},step:{type:[Number,String],default:1},range:Boolean,value:[Number,Array],placement:String,showTooltip:{type:Boolean,default:void 0},tooltip:{type:Boolean,default:!0},vertical:Boolean,reverse:Boolean,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onDragstart:[Function],onDragend:[Function]}),Mt=Ne({name:"Slider",props:Vt,slots:Object,setup(t){const{mergedClsPrefixRef:i,namespaceRef:w,inlineThemeDisabled:h}=je(t),l=ve("Slider","-slider",Bt,Rt,t,i),f=D(null),[x,C]=Ie(),[A,$]=Ie(),M=D(new Set),V=Pe(t),{mergedDisabledRef:v}=V,T=k(()=>{const{step:e}=t;if(Number(e)<=0||e==="mark")return 0;const o=e.toString();let a=0;return o.includes(".")&&(a=o.length-o.indexOf(".")-1),a}),z=D(t.defaultValue),be=Ee(t,"value"),G=Oe(be,z),R=k(()=>{const{value:e}=G;return(t.range?e:[e]).map(j)}),ne=k(()=>R.value.length>2),ge=k(()=>t.placement===void 0?t.vertical?"right":"top":t.placement),re=k(()=>{const{marks:e}=t;return e?Object.keys(e).map(Number.parseFloat):null}),S=D(-1),J=D(-1),y=D(-1),s=D(!1),H=D(!1),N=k(()=>{const{vertical:e,reverse:o}=t;return e?o?"top":"bottom":o?"right":"left"}),W=k(()=>{if(ne.value)return;const e=R.value,o=X(t.range?Math.min(...e):t.min),a=X(t.range?Math.max(...e):e[0]),{value:r}=N;return t.vertical?{[r]:`${o}%`,height:`${a-o}%`}:{[r]:`${o}%`,width:`${a-o}%`}}),Z=k(()=>{const e=[],{marks:o}=t;if(o){const a=R.value.slice();a.sort((p,m)=>p-m);const{value:r}=N,{value:u}=ne,{range:g}=t,_=u?()=>!1:p=>g?p>=a[0]&&p<=a[a.length-1]:p<=a[0];for(const p of Object.keys(o)){const m=Number(p);e.push({active:_(m),key:m,label:o[p],style:{[r]:`${X(m)}%`}})}}return e});function ee(e,o){const a=X(e),{value:r}=N;return{[r]:`${a}%`,zIndex:o===S.value?1:0}}function ie(e){return t.showTooltip||y.value===e||S.value===e&&s.value}function me(e){return s.value?!(S.value===e&&J.value===e):!0}function we(e){var o;~e&&(S.value=e,(o=x.get(e))===null||o===void 0||o.focus())}function pe(){A.forEach((e,o)=>{ie(o)&&e.syncPosition()})}function F(e){const{"onUpdate:value":o,onUpdateValue:a}=t,{nTriggerFormInput:r,nTriggerFormChange:u}=V;a&&L(a,e),o&&L(o,e),z.value=e,r(),u()}function le(e){const{range:o}=t;if(o){if(Array.isArray(e)){const{value:a}=R;e.join()!==a.join()&&F(e)}}else Array.isArray(e)||R.value[0]!==e&&F(e)}function te(e,o){if(t.range){const a=R.value.slice();a.splice(o,1,e),le(a)}else le(e)}function B(e,o,a){const r=a!==void 0;a||(a=e-o>0?1:-1);const u=re.value||[],{step:g}=t;if(g==="mark"){const m=P(e,u.concat(o),r?a:void 0);return m?m.value:o}if(g<=0)return o;const{value:_}=T;let p;if(r){const m=Number((o/g).toFixed(_)),E=Math.floor(m),ke=m>E?E:E-1,Ce=m<E?E:E+1;p=P(o,[Number((ke*g).toFixed(_)),Number((Ce*g).toFixed(_)),...u],a)}else{const m=ye(e);p=P(e,[...u,m])}return p?j(p.value):o}function j(e){return Math.min(t.max,Math.max(t.min,e))}function X(e){const{max:o,min:a}=t;return(e-a)/(o-a)*100}function xe(e){const{max:o,min:a}=t;return a+(o-a)*e}function ye(e){const{step:o,min:a}=t;if(Number(o)<=0||o==="mark")return e;const r=Math.round((e-a)/o)*o+a;return Number(r.toFixed(T.value))}function P(e,o=re.value,a){if(!o?.length)return null;let r=null,u=-1;for(;++u<o.length;){const g=o[u]-e,_=Math.abs(g);(a===void 0||g*a>0)&&(r===null||_<r.distance)&&(r={index:u,distance:_,value:o[u]})}return r}function Y(e){const o=f.value;if(!o)return;const a=He(e)?e.touches[0]:e,r=o.getBoundingClientRect();let u;return t.vertical?u=(r.bottom-a.clientY)/r.height:u=(a.clientX-r.left)/r.width,t.reverse&&(u=1-u),xe(u)}function oe(e){if(v.value||!t.keyboard)return;const{vertical:o,reverse:a}=t;switch(e.key){case"ArrowUp":e.preventDefault(),se(o&&a?-1:1);break;case"ArrowRight":e.preventDefault(),se(!o&&a?-1:1);break;case"ArrowDown":e.preventDefault(),se(o&&a?1:-1);break;case"ArrowLeft":e.preventDefault(),se(!o&&a?1:-1);break}}function se(e){const o=S.value;if(o===-1)return;const{step:a}=t,r=R.value[o],u=Number(a)<=0||a==="mark"?r:r+a*e;te(B(u,r,e>0?1:-1),o)}function Ue(e){var o,a;if(v.value||!He(e)&&e.button!==$t)return;const r=Y(e);if(r===void 0)return;const u=R.value.slice(),g=t.range?(a=(o=P(r,u))===null||o===void 0?void 0:o.index)!==null&&a!==void 0?a:-1:0;g!==-1&&(e.preventDefault(),we(g),Ke(),te(B(r,R.value[g]),g))}function Ke(){s.value||(s.value=!0,t.onDragstart&&L(t.onDragstart),he("touchend",document,ue),he("mouseup",document,ue),he("touchmove",document,ce),he("mousemove",document,ce))}function de(){s.value&&(s.value=!1,t.onDragend&&L(t.onDragend),fe("touchend",document,ue),fe("mouseup",document,ue),fe("touchmove",document,ce),fe("mousemove",document,ce))}function ce(e){const{value:o}=S;if(!s.value||o===-1){de();return}const a=Y(e);a!==void 0&&te(B(a,R.value[o]),o)}function ue(){de()}function Le(e){S.value=e,v.value||(y.value=e)}function We(e){S.value===e&&(S.value=-1,de()),y.value===e&&(y.value=-1)}function Xe(e){y.value=e}function Ye(e){y.value===e&&(y.value=-1)}De(S,(e,o)=>void Re(()=>J.value=o)),De(G,()=>{if(t.marks){if(H.value)return;H.value=!0,Re(()=>{H.value=!1})}Re(pe)}),pt(()=>{de()});const Ve=k(()=>{const{self:{markFontSize:e,railColor:o,railColorHover:a,fillColor:r,fillColorHover:u,handleColor:g,opacityDisabled:_,dotColor:p,dotColorModal:m,handleBoxShadow:E,handleBoxShadowHover:ke,handleBoxShadowActive:Ce,handleBoxShadowFocus:qe,dotBorder:Qe,dotBoxShadow:Ge,railHeight:Je,railWidthVertical:Ze,handleSize:et,dotHeight:tt,dotWidth:ot,dotBorderRadius:at,fontSize:nt,dotBorderActive:rt,dotColorPopover:it},common:{cubicBezierEaseInOut:lt}}=l.value;return{"--n-bezier":lt,"--n-dot-border":Qe,"--n-dot-border-active":rt,"--n-dot-border-radius":at,"--n-dot-box-shadow":Ge,"--n-dot-color":p,"--n-dot-color-modal":m,"--n-dot-color-popover":it,"--n-dot-height":tt,"--n-dot-width":ot,"--n-fill-color":r,"--n-fill-color-hover":u,"--n-font-size":nt,"--n-handle-box-shadow":E,"--n-handle-box-shadow-active":Ce,"--n-handle-box-shadow-focus":qe,"--n-handle-box-shadow-hover":ke,"--n-handle-color":g,"--n-handle-size":et,"--n-opacity-disabled":_,"--n-rail-color":o,"--n-rail-color-hover":a,"--n-rail-height":Je,"--n-rail-width-vertical":Ze,"--n-mark-font-size":e}}),q=h?$e("slider",void 0,Ve,t):void 0,Te=k(()=>{const{self:{fontSize:e,indicatorColor:o,indicatorBoxShadow:a,indicatorTextColor:r,indicatorBorderRadius:u}}=l.value;return{"--n-font-size":e,"--n-indicator-border-radius":u,"--n-indicator-box-shadow":a,"--n-indicator-color":o,"--n-indicator-text-color":r}}),Q=h?$e("slider-indicator",void 0,Te,t):void 0;return{mergedClsPrefix:i,namespace:w,uncontrolledValue:z,mergedValue:G,mergedDisabled:v,mergedPlacement:ge,isMounted:xt(),adjustedTo:Be(t),dotTransitionDisabled:H,markInfos:Z,isShowTooltip:ie,shouldKeepTooltipTransition:me,handleRailRef:f,setHandleRefs:C,setFollowerRefs:$,fillStyle:W,getHandleStyle:ee,activeIndex:S,arrifiedValues:R,followerEnabledIndexSet:M,handleRailMouseDown:Ue,handleHandleFocus:Le,handleHandleBlur:We,handleHandleMouseEnter:Xe,handleHandleMouseLeave:Ye,handleRailKeyDown:oe,indicatorCssVars:h?void 0:Te,indicatorThemeClass:Q?.themeClass,indicatorOnRender:Q?.onRender,cssVars:h?void 0:Ve,themeClass:q?.themeClass,onRender:q?.onRender}},render(){var t;const{mergedClsPrefix:i,themeClass:w,formatTooltip:h}=this;return(t=this.onRender)===null||t===void 0||t.call(this),c("div",{class:[`${i}-slider`,w,{[`${i}-slider--disabled`]:this.mergedDisabled,[`${i}-slider--active`]:this.activeIndex!==-1,[`${i}-slider--with-mark`]:this.marks,[`${i}-slider--vertical`]:this.vertical,[`${i}-slider--reverse`]:this.reverse}],style:this.cssVars,onKeydown:this.handleRailKeyDown,onMousedown:this.handleRailMouseDown,onTouchstart:this.handleRailMouseDown},c("div",{class:`${i}-slider-rail`},c("div",{class:`${i}-slider-rail__fill`,style:this.fillStyle}),this.marks?c("div",{class:[`${i}-slider-dots`,this.dotTransitionDisabled&&`${i}-slider-dots--transition-disabled`]},this.markInfos.map(l=>c("div",{key:l.key,class:[`${i}-slider-dot`,{[`${i}-slider-dot--active`]:l.active}],style:l.style}))):null,c("div",{ref:"handleRailRef",class:`${i}-slider-handles`},this.arrifiedValues.map((l,f)=>{const x=this.isShowTooltip(f);return c(vt,null,{default:()=>[c(bt,null,{default:()=>c("div",{ref:this.setHandleRefs(f),class:`${i}-slider-handle-wrapper`,tabindex:this.mergedDisabled?-1:0,role:"slider","aria-valuenow":l,"aria-valuemin":this.min,"aria-valuemax":this.max,"aria-orientation":this.vertical?"vertical":"horizontal","aria-disabled":this.disabled,style:this.getHandleStyle(l,f),onFocus:()=>{this.handleHandleFocus(f)},onBlur:()=>{this.handleHandleBlur(f)},onMouseenter:()=>{this.handleHandleMouseEnter(f)},onMouseleave:()=>{this.handleHandleMouseLeave(f)}},gt(this.$slots.thumb,()=>[c("div",{class:`${i}-slider-handle`})]))}),this.tooltip&&c(mt,{ref:this.setFollowerRefs(f),show:x,to:this.adjustedTo,enabled:this.showTooltip&&!this.range||this.followerEnabledIndexSet.has(f),teleportDisabled:this.adjustedTo===Be.tdkey,placement:this.mergedPlacement,containerClass:this.namespace},{default:()=>c(wt,{name:"fade-in-scale-up-transition",appear:this.isMounted,css:this.shouldKeepTooltipTransition(f),onEnter:()=>{this.followerEnabledIndexSet.add(f)},onAfterLeave:()=>{this.followerEnabledIndexSet.delete(f)}},{default:()=>{var C;return x?((C=this.indicatorOnRender)===null||C===void 0||C.call(this),c("div",{class:[`${i}-slider-handle-indicator`,this.indicatorThemeClass,`${i}-slider-handle-indicator--${this.mergedPlacement}`],style:this.indicatorCssVars},typeof h=="function"?h(l):l)):null}})})]})})),this.marks?c("div",{class:`${i}-slider-marks`},this.markInfos.map(l=>c("div",{key:l.key,class:`${i}-slider-mark`,style:l.style},typeof l.label=="function"?l.label():l.label))):null))}}),Tt=n("switch",`
 height: var(--n-height);
 min-width: var(--n-width);
 vertical-align: middle;
 user-select: none;
 -webkit-user-select: none;
 display: inline-flex;
 outline: none;
 justify-content: center;
 align-items: center;
`,[d("children-placeholder",`
 height: var(--n-rail-height);
 display: flex;
 flex-direction: column;
 overflow: hidden;
 pointer-events: none;
 visibility: hidden;
 `),d("rail-placeholder",`
 display: flex;
 flex-wrap: none;
 `),d("button-placeholder",`
 width: calc(1.75 * var(--n-rail-height));
 height: var(--n-rail-height);
 `),n("base-loading",`
 position: absolute;
 top: 50%;
 left: 50%;
 transform: translateX(-50%) translateY(-50%);
 font-size: calc(var(--n-button-width) - 4px);
 color: var(--n-loading-color);
 transition: color .3s var(--n-bezier);
 `,[_e({left:"50%",top:"50%",originalTransform:"translateX(-50%) translateY(-50%)"})]),d("checked, unchecked",`
 transition: color .3s var(--n-bezier);
 color: var(--n-text-color);
 box-sizing: border-box;
 position: absolute;
 white-space: nowrap;
 top: 0;
 bottom: 0;
 display: flex;
 align-items: center;
 line-height: 1;
 `),d("checked",`
 right: 0;
 padding-right: calc(1.25 * var(--n-rail-height) - var(--n-offset));
 `),d("unchecked",`
 left: 0;
 justify-content: flex-end;
 padding-left: calc(1.25 * var(--n-rail-height) - var(--n-offset));
 `),O("&:focus",[d("rail",`
 box-shadow: var(--n-box-shadow-focus);
 `)]),b("round",[d("rail","border-radius: calc(var(--n-rail-height) / 2);",[d("button","border-radius: calc(var(--n-button-height) / 2);")])]),Me("disabled",[Me("icon",[b("rubber-band",[b("pressed",[d("rail",[d("button","max-width: var(--n-button-width-pressed);")])]),d("rail",[O("&:active",[d("button","max-width: var(--n-button-width-pressed);")])]),b("active",[b("pressed",[d("rail",[d("button","left: calc(100% - var(--n-offset) - var(--n-button-width-pressed));")])]),d("rail",[O("&:active",[d("button","left: calc(100% - var(--n-offset) - var(--n-button-width-pressed));")])])])])])]),b("active",[d("rail",[d("button","left: calc(100% - var(--n-button-width) - var(--n-offset))")])]),d("rail",`
 overflow: hidden;
 height: var(--n-rail-height);
 min-width: var(--n-rail-width);
 border-radius: var(--n-rail-border-radius);
 cursor: pointer;
 position: relative;
 transition:
 opacity .3s var(--n-bezier),
 background .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier);
 background-color: var(--n-rail-color);
 `,[d("button-icon",`
 color: var(--n-icon-color);
 transition: color .3s var(--n-bezier);
 font-size: calc(var(--n-button-height) - 4px);
 position: absolute;
 left: 0;
 right: 0;
 top: 0;
 bottom: 0;
 display: flex;
 justify-content: center;
 align-items: center;
 line-height: 1;
 `,[_e()]),d("button",`
 align-items: center; 
 top: var(--n-offset);
 left: var(--n-offset);
 height: var(--n-button-height);
 width: var(--n-button-width-pressed);
 max-width: var(--n-button-width);
 border-radius: var(--n-button-border-radius);
 background-color: var(--n-button-color);
 box-shadow: var(--n-button-box-shadow);
 box-sizing: border-box;
 cursor: inherit;
 content: "";
 position: absolute;
 transition:
 background-color .3s var(--n-bezier),
 left .3s var(--n-bezier),
 opacity .3s var(--n-bezier),
 max-width .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier);
 `)]),b("active",[d("rail","background-color: var(--n-rail-color-active);")]),b("loading",[d("rail",`
 cursor: wait;
 `)]),b("disabled",[d("rail",`
 cursor: not-allowed;
 opacity: .5;
 `)])]),Ft=Object.assign(Object.assign({},ve.props),{size:{type:String,default:"medium"},value:{type:[String,Number,Boolean],default:void 0},loading:Boolean,defaultValue:{type:[String,Number,Boolean],default:!1},disabled:{type:Boolean,default:void 0},round:{type:Boolean,default:!0},"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],checkedValue:{type:[String,Number,Boolean],default:!0},uncheckedValue:{type:[String,Number,Boolean],default:!1},railStyle:Function,rubberBand:{type:Boolean,default:!0},onChange:[Function,Array]});let ae;const _t=Ne({name:"Switch",props:Ft,slots:Object,setup(t){ae===void 0&&(typeof CSS<"u"?typeof CSS.supports<"u"?ae=CSS.supports("width","max(1px)"):ae=!1:ae=!0);const{mergedClsPrefixRef:i,inlineThemeDisabled:w}=je(t),h=ve("Switch","-switch",Tt,zt,t,i),l=Pe(t),{mergedSizeRef:f,mergedDisabledRef:x}=l,C=D(t.defaultValue),A=Ee(t,"value"),$=Oe(A,C),M=k(()=>$.value===t.checkedValue),V=D(!1),v=D(!1),T=k(()=>{const{railStyle:s}=t;if(s)return s({focused:v.value,checked:M.value})});function z(s){const{"onUpdate:value":H,onChange:N,onUpdateValue:W}=t,{nTriggerFormInput:Z,nTriggerFormChange:ee}=l;H&&L(H,s),W&&L(W,s),N&&L(N,s),C.value=s,Z(),ee()}function be(){const{nTriggerFormFocus:s}=l;s()}function G(){const{nTriggerFormBlur:s}=l;s()}function R(){t.loading||x.value||($.value!==t.checkedValue?z(t.checkedValue):z(t.uncheckedValue))}function ne(){v.value=!0,be()}function ge(){v.value=!1,G(),V.value=!1}function re(s){t.loading||x.value||s.key===" "&&($.value!==t.checkedValue?z(t.checkedValue):z(t.uncheckedValue),V.value=!1)}function S(s){t.loading||x.value||s.key===" "&&(s.preventDefault(),V.value=!0)}const J=k(()=>{const{value:s}=f,{self:{opacityDisabled:H,railColor:N,railColorActive:W,buttonBoxShadow:Z,buttonColor:ee,boxShadowFocus:ie,loadingColor:me,textColor:we,iconColor:pe,[K("buttonHeight",s)]:F,[K("buttonWidth",s)]:le,[K("buttonWidthPressed",s)]:te,[K("railHeight",s)]:B,[K("railWidth",s)]:j,[K("railBorderRadius",s)]:X,[K("buttonBorderRadius",s)]:xe},common:{cubicBezierEaseInOut:ye}}=h.value;let P,Y,oe;return ae?(P=`calc((${B} - ${F}) / 2)`,Y=`max(${B}, ${F})`,oe=`max(${j}, calc(${j} + ${F} - ${B}))`):(P=ze((I(B)-I(F))/2),Y=ze(Math.max(I(B),I(F))),oe=I(B)>I(F)?j:ze(I(j)+I(F)-I(B))),{"--n-bezier":ye,"--n-button-border-radius":xe,"--n-button-box-shadow":Z,"--n-button-color":ee,"--n-button-width":le,"--n-button-width-pressed":te,"--n-button-height":F,"--n-height":Y,"--n-offset":P,"--n-opacity-disabled":H,"--n-rail-border-radius":X,"--n-rail-color":N,"--n-rail-color-active":W,"--n-rail-height":B,"--n-rail-width":j,"--n-width":oe,"--n-box-shadow-focus":ie,"--n-loading-color":me,"--n-text-color":we,"--n-icon-color":pe}}),y=w?$e("switch",k(()=>f.value[0]),J,t):void 0;return{handleClick:R,handleBlur:ge,handleFocus:ne,handleKeyup:re,handleKeydown:S,mergedRailStyle:T,pressed:V,mergedClsPrefix:i,mergedValue:$,checked:M,mergedDisabled:x,cssVars:w?void 0:J,themeClass:y?.themeClass,onRender:y?.onRender}},render(){const{mergedClsPrefix:t,mergedDisabled:i,checked:w,mergedRailStyle:h,onRender:l,$slots:f}=this;l?.();const{checked:x,unchecked:C,icon:A,"checked-icon":$,"unchecked-icon":M}=f,V=!(Se(A)&&Se($)&&Se(M));return c("div",{role:"switch","aria-checked":w,class:[`${t}-switch`,this.themeClass,V&&`${t}-switch--icon`,w&&`${t}-switch--active`,i&&`${t}-switch--disabled`,this.round&&`${t}-switch--round`,this.loading&&`${t}-switch--loading`,this.pressed&&`${t}-switch--pressed`,this.rubberBand&&`${t}-switch--rubber-band`],tabindex:this.mergedDisabled?void 0:0,style:this.cssVars,onClick:this.handleClick,onFocus:this.handleFocus,onBlur:this.handleBlur,onKeyup:this.handleKeyup,onKeydown:this.handleKeydown},c("div",{class:`${t}-switch__rail`,"aria-hidden":"true",style:h},U(x,v=>U(C,T=>v||T?c("div",{"aria-hidden":!0,class:`${t}-switch__children-placeholder`},c("div",{class:`${t}-switch__rail-placeholder`},c("div",{class:`${t}-switch__button-placeholder`}),v),c("div",{class:`${t}-switch__rail-placeholder`},c("div",{class:`${t}-switch__button-placeholder`}),T)):null)),c("div",{class:`${t}-switch__button`},U(A,v=>U($,T=>U(M,z=>c(yt,null,{default:()=>this.loading?c(kt,{key:"loading",clsPrefix:t,strokeWidth:20}):this.checked&&(T||v)?c("div",{class:`${t}-switch__button-icon`,key:T?"checked-icon":"icon"},T||v):!this.checked&&(z||v)?c("div",{class:`${t}-switch__button-icon`,key:z?"unchecked-icon":"icon"},z||v):null})))),U(x,v=>v&&c("div",{key:"checked",class:`${t}-switch__checked`},v)),U(C,v=>v&&c("div",{key:"unchecked",class:`${t}-switch__unchecked`},v)))))}});export{_t as N,Mt as a};
