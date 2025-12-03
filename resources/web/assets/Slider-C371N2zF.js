import{n as We,bA as Ze,e as B,c as n,aB as qe,aC as Ge,b,f as j,bu as he,bB as Je,d as Qe,h as f,bC as eo,bD as oo,t as to,bE as ao,bd as ee,bw as no,u as ro,A as ge,x as y,b4 as io,C as p,y as lo,z as so,ab as fe,bl as co,D as ve,bF as uo,I as O,b6 as U,bm as _,aZ as Q}from"./index-DILGEmlc.js";function ho(a){const i="rgba(0, 0, 0, .85)",k="0 2px 8px 0 rgba(0, 0, 0, 0.12)",{railColor:v,primaryColor:s,baseColor:d,cardColor:S,modalColor:C,popoverColor:L,borderRadius:K,fontSize:M,opacityDisabled:V}=a;return Object.assign(Object.assign({},Ze),{fontSize:M,markFontSize:M,railColor:v,railColorHover:v,fillColor:s,fillColorHover:s,opacityDisabled:V,handleColor:"#FFF",dotColor:S,dotColorModal:C,dotColorPopover:L,handleBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowHover:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowActive:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowFocus:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",indicatorColor:i,indicatorBoxShadow:k,indicatorTextColor:d,indicatorBorderRadius:K,dotBorder:`2px solid ${v}`,dotBorderActive:`2px solid ${s}`,dotBoxShadow:""})}const fo={common:We,self:ho},vo=B([n("slider",`
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
 `,[j("fill",`
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
 `),B("&:hover",[n("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[j("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),n("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),b("active",[n("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[j("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),n("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),n("slider-marks",`
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
 `,[j("fill",`
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
 `,[B("&:hover",`
 box-shadow: var(--n-handle-box-shadow-hover);
 `)]),B("&:focus",[n("slider-handle",`
 box-shadow: var(--n-handle-box-shadow-focus);
 `,[B("&:hover",`
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
 `,[he()]),n("slider-handle-indicator",`
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
 `),he()]),qe(n("slider",[n("slider-dot","background-color: var(--n-dot-color-modal);")])),Ge(n("slider",[n("slider-dot","background-color: var(--n-dot-color-popover);")]))]);function be(a){return window.TouchEvent&&a instanceof window.TouchEvent}function me(){const a=new Map,i=k=>v=>{a.set(k,v)};return Je(()=>{a.clear()}),[a,i]}const bo=0,mo=Object.assign(Object.assign({},ge.props),{to:ee.propTo,defaultValue:{type:[Number,Array],default:0},marks:Object,disabled:{type:Boolean,default:void 0},formatTooltip:Function,keyboard:{type:Boolean,default:!0},min:{type:Number,default:0},max:{type:Number,default:100},step:{type:[Number,String],default:1},range:Boolean,value:[Number,Array],placement:String,showTooltip:{type:Boolean,default:void 0},tooltip:{type:Boolean,default:!0},vertical:Boolean,reverse:Boolean,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onDragstart:[Function],onDragend:[Function]}),wo=Qe({name:"Slider",props:mo,slots:Object,setup(a){const{mergedClsPrefixRef:i,namespaceRef:k,inlineThemeDisabled:v}=ro(a),s=ge("Slider","-slider",vo,fo,a,i),d=y(null),[S,C]=me(),[L,K]=me(),M=y(new Set),V=io(a),{mergedDisabledRef:$}=V,oe=p(()=>{const{step:e}=a;if(Number(e)<=0||e==="mark")return 0;const o=e.toString();let t=0;return o.includes(".")&&(t=o.length-o.indexOf(".")-1),t}),X=y(a.defaultValue),we=lo(a,"value"),Y=so(we,X),m=p(()=>{const{value:e}=Y;return(a.range?e:[e]).map(se)}),te=p(()=>m.value.length>2),pe=p(()=>a.placement===void 0?a.vertical?"right":"top":a.placement),ae=p(()=>{const{marks:e}=a;return e?Object.keys(e).map(Number.parseFloat):null}),g=y(-1),ne=y(-1),R=y(-1),z=y(!1),F=y(!1),W=p(()=>{const{vertical:e,reverse:o}=a;return e?o?"top":"bottom":o?"right":"left"}),xe=p(()=>{if(te.value)return;const e=m.value,o=I(a.range?Math.min(...e):a.min),t=I(a.range?Math.max(...e):e[0]),{value:r}=W;return a.vertical?{[r]:`${o}%`,height:`${t-o}%`}:{[r]:`${o}%`,width:`${t-o}%`}}),ye=p(()=>{const e=[],{marks:o}=a;if(o){const t=m.value.slice();t.sort((h,u)=>h-u);const{value:r}=W,{value:l}=te,{range:c}=a,w=l?()=>!1:h=>c?h>=t[0]&&h<=t[t.length-1]:h<=t[0];for(const h of Object.keys(o)){const u=Number(h);e.push({active:w(u),key:u,label:o[h],style:{[r]:`${I(u)}%`}})}}return e});function ke(e,o){const t=I(e),{value:r}=W;return{[r]:`${t}%`,zIndex:o===g.value?1:0}}function re(e){return a.showTooltip||R.value===e||g.value===e&&z.value}function Ce(e){return z.value?!(g.value===e&&ne.value===e):!0}function Re(e){var o;~e&&(g.value=e,(o=S.get(e))===null||o===void 0||o.focus())}function ze(){L.forEach((e,o)=>{re(o)&&e.syncPosition()})}function ie(e){const{"onUpdate:value":o,onUpdateValue:t}=a,{nTriggerFormInput:r,nTriggerFormChange:l}=V;t&&O(t,e),o&&O(o,e),X.value=e,r(),l()}function le(e){const{range:o}=a;if(o){if(Array.isArray(e)){const{value:t}=m;e.join()!==t.join()&&ie(e)}}else Array.isArray(e)||m.value[0]!==e&&ie(e)}function Z(e,o){if(a.range){const t=m.value.slice();t.splice(o,1,e),le(t)}else le(e)}function q(e,o,t){const r=t!==void 0;t||(t=e-o>0?1:-1);const l=ae.value||[],{step:c}=a;if(c==="mark"){const u=H(e,l.concat(o),r?t:void 0);return u?u.value:o}if(c<=0)return o;const{value:w}=oe;let h;if(r){const u=Number((o/c).toFixed(w)),x=Math.floor(u),G=u>x?x:x-1,J=u<x?x:x+1;h=H(o,[Number((G*c).toFixed(w)),Number((J*c).toFixed(w)),...l],t)}else{const u=Te(e);h=H(e,[...l,u])}return h?se(h.value):o}function se(e){return Math.min(a.max,Math.max(a.min,e))}function I(e){const{max:o,min:t}=a;return(e-t)/(o-t)*100}function Se(e){const{max:o,min:t}=a;return t+(o-t)*e}function Te(e){const{step:o,min:t}=a;if(Number(o)<=0||o==="mark")return e;const r=Math.round((e-t)/o)*o+t;return Number(r.toFixed(oe.value))}function H(e,o=ae.value,t){if(!o?.length)return null;let r=null,l=-1;for(;++l<o.length;){const c=o[l]-e,w=Math.abs(c);(t===void 0||c*t>0)&&(r===null||w<r.distance)&&(r={index:l,distance:w,value:o[l]})}return r}function de(e){const o=d.value;if(!o)return;const t=be(e)?e.touches[0]:e,r=o.getBoundingClientRect();let l;return a.vertical?l=(r.bottom-t.clientY)/r.height:l=(t.clientX-r.left)/r.width,a.reverse&&(l=1-l),Se(l)}function De(e){if($.value||!a.keyboard)return;const{vertical:o,reverse:t}=a;switch(e.key){case"ArrowUp":e.preventDefault(),A(o&&t?-1:1);break;case"ArrowRight":e.preventDefault(),A(!o&&t?-1:1);break;case"ArrowDown":e.preventDefault(),A(o&&t?1:-1);break;case"ArrowLeft":e.preventDefault(),A(!o&&t?1:-1);break}}function A(e){const o=g.value;if(o===-1)return;const{step:t}=a,r=m.value[o],l=Number(t)<=0||t==="mark"?r:r+t*e;Z(q(l,r,e>0?1:-1),o)}function Be(e){var o,t;if($.value||!be(e)&&e.button!==bo)return;const r=de(e);if(r===void 0)return;const l=m.value.slice(),c=a.range?(t=(o=H(r,l))===null||o===void 0?void 0:o.index)!==null&&t!==void 0?t:-1:0;c!==-1&&(e.preventDefault(),Re(c),Me(),Z(q(r,m.value[c]),c))}function Me(){z.value||(z.value=!0,a.onDragstart&&O(a.onDragstart),U("touchend",document,P),U("mouseup",document,P),U("touchmove",document,N),U("mousemove",document,N))}function E(){z.value&&(z.value=!1,a.onDragend&&O(a.onDragend),_("touchend",document,P),_("mouseup",document,P),_("touchmove",document,N),_("mousemove",document,N))}function N(e){const{value:o}=g;if(!z.value||o===-1){E();return}const t=de(e);t!==void 0&&Z(q(t,m.value[o]),o)}function P(){E()}function Ve(e){g.value=e,$.value||(R.value=e)}function $e(e){g.value===e&&(g.value=-1,E()),R.value===e&&(R.value=-1)}function Fe(e){R.value=e}function Ie(e){R.value===e&&(R.value=-1)}fe(g,(e,o)=>void Q(()=>ne.value=o)),fe(Y,()=>{if(a.marks){if(F.value)return;F.value=!0,Q(()=>{F.value=!1})}Q(ze)}),co(()=>{E()});const ce=p(()=>{const{self:{markFontSize:e,railColor:o,railColorHover:t,fillColor:r,fillColorHover:l,handleColor:c,opacityDisabled:w,dotColor:h,dotColorModal:u,handleBoxShadow:x,handleBoxShadowHover:G,handleBoxShadowActive:J,handleBoxShadowFocus:He,dotBorder:Ae,dotBoxShadow:Ee,railHeight:Ne,railWidthVertical:Pe,handleSize:je,dotHeight:Oe,dotWidth:Ue,dotBorderRadius:_e,fontSize:Le,dotBorderActive:Ke,dotColorPopover:Xe},common:{cubicBezierEaseInOut:Ye}}=s.value;return{"--n-bezier":Ye,"--n-dot-border":Ae,"--n-dot-border-active":Ke,"--n-dot-border-radius":_e,"--n-dot-box-shadow":Ee,"--n-dot-color":h,"--n-dot-color-modal":u,"--n-dot-color-popover":Xe,"--n-dot-height":Oe,"--n-dot-width":Ue,"--n-fill-color":r,"--n-fill-color-hover":l,"--n-font-size":Le,"--n-handle-box-shadow":x,"--n-handle-box-shadow-active":J,"--n-handle-box-shadow-focus":He,"--n-handle-box-shadow-hover":G,"--n-handle-color":c,"--n-handle-size":je,"--n-opacity-disabled":w,"--n-rail-color":o,"--n-rail-color-hover":t,"--n-rail-height":Ne,"--n-rail-width-vertical":Pe,"--n-mark-font-size":e}}),T=v?ve("slider",void 0,ce,a):void 0,ue=p(()=>{const{self:{fontSize:e,indicatorColor:o,indicatorBoxShadow:t,indicatorTextColor:r,indicatorBorderRadius:l}}=s.value;return{"--n-font-size":e,"--n-indicator-border-radius":l,"--n-indicator-box-shadow":t,"--n-indicator-color":o,"--n-indicator-text-color":r}}),D=v?ve("slider-indicator",void 0,ue,a):void 0;return{mergedClsPrefix:i,namespace:k,uncontrolledValue:X,mergedValue:Y,mergedDisabled:$,mergedPlacement:pe,isMounted:uo(),adjustedTo:ee(a),dotTransitionDisabled:F,markInfos:ye,isShowTooltip:re,shouldKeepTooltipTransition:Ce,handleRailRef:d,setHandleRefs:C,setFollowerRefs:K,fillStyle:xe,getHandleStyle:ke,activeIndex:g,arrifiedValues:m,followerEnabledIndexSet:M,handleRailMouseDown:Be,handleHandleFocus:Ve,handleHandleBlur:$e,handleHandleMouseEnter:Fe,handleHandleMouseLeave:Ie,handleRailKeyDown:De,indicatorCssVars:v?void 0:ue,indicatorThemeClass:D?.themeClass,indicatorOnRender:D?.onRender,cssVars:v?void 0:ce,themeClass:T?.themeClass,onRender:T?.onRender}},render(){var a;const{mergedClsPrefix:i,themeClass:k,formatTooltip:v}=this;return(a=this.onRender)===null||a===void 0||a.call(this),f("div",{class:[`${i}-slider`,k,{[`${i}-slider--disabled`]:this.mergedDisabled,[`${i}-slider--active`]:this.activeIndex!==-1,[`${i}-slider--with-mark`]:this.marks,[`${i}-slider--vertical`]:this.vertical,[`${i}-slider--reverse`]:this.reverse}],style:this.cssVars,onKeydown:this.handleRailKeyDown,onMousedown:this.handleRailMouseDown,onTouchstart:this.handleRailMouseDown},f("div",{class:`${i}-slider-rail`},f("div",{class:`${i}-slider-rail__fill`,style:this.fillStyle}),this.marks?f("div",{class:[`${i}-slider-dots`,this.dotTransitionDisabled&&`${i}-slider-dots--transition-disabled`]},this.markInfos.map(s=>f("div",{key:s.key,class:[`${i}-slider-dot`,{[`${i}-slider-dot--active`]:s.active}],style:s.style}))):null,f("div",{ref:"handleRailRef",class:`${i}-slider-handles`},this.arrifiedValues.map((s,d)=>{const S=this.isShowTooltip(d);return f(eo,null,{default:()=>[f(oo,null,{default:()=>f("div",{ref:this.setHandleRefs(d),class:`${i}-slider-handle-wrapper`,tabindex:this.mergedDisabled?-1:0,role:"slider","aria-valuenow":s,"aria-valuemin":this.min,"aria-valuemax":this.max,"aria-orientation":this.vertical?"vertical":"horizontal","aria-disabled":this.disabled,style:this.getHandleStyle(s,d),onFocus:()=>{this.handleHandleFocus(d)},onBlur:()=>{this.handleHandleBlur(d)},onMouseenter:()=>{this.handleHandleMouseEnter(d)},onMouseleave:()=>{this.handleHandleMouseLeave(d)}},to(this.$slots.thumb,()=>[f("div",{class:`${i}-slider-handle`})]))}),this.tooltip&&f(ao,{ref:this.setFollowerRefs(d),show:S,to:this.adjustedTo,enabled:this.showTooltip&&!this.range||this.followerEnabledIndexSet.has(d),teleportDisabled:this.adjustedTo===ee.tdkey,placement:this.mergedPlacement,containerClass:this.namespace},{default:()=>f(no,{name:"fade-in-scale-up-transition",appear:this.isMounted,css:this.shouldKeepTooltipTransition(d),onEnter:()=>{this.followerEnabledIndexSet.add(d)},onAfterLeave:()=>{this.followerEnabledIndexSet.delete(d)}},{default:()=>{var C;return S?((C=this.indicatorOnRender)===null||C===void 0||C.call(this),f("div",{class:[`${i}-slider-handle-indicator`,this.indicatorThemeClass,`${i}-slider-handle-indicator--${this.mergedPlacement}`],style:this.indicatorCssVars},typeof v=="function"?v(s):s)):null}})})]})})),this.marks?f("div",{class:`${i}-slider-marks`},this.markInfos.map(s=>f("div",{key:s.key,class:`${i}-slider-mark`,style:s.style},typeof s.label=="function"?s.label():s.label))):null))}});export{wo as N};
