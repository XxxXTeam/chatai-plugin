import{d as Z,h as d,x as A,aH as pt,aI as me,aJ as ut,aK as vt,aL as ye,aM as ze,q as ht,s as $e,aq as gt,aN as xt,aO as mt,a3 as yt,v as wt,aP as St,C as Q,aQ as Ct,c as r,b as i,e as m,f as T,a as Rt,aD as re,r as we,aR as ne,u as Tt,A as Pe,aS as zt,av as Se,z as $t,ab as oe,L as Pt,p as Wt,y as j,aT as Lt,aU as _t,au as H,aV as K,D as Et,aW as At,af as Bt,aX as kt,aY as jt,aZ as ie,an as Ht,I as J}from"./index-Bsw7oJ13.js";import{A as It}from"./Add-Dox3aWAK.js";const Ot=me(".v-x-scroll",{overflow:"auto",scrollbarWidth:"none"},[me("&::-webkit-scrollbar",{width:0,height:0})]),Ft=Z({name:"XScroll",props:{disabled:Boolean,onScroll:Function},setup(){const e=A(null);function o(l){!(l.currentTarget.offsetWidth<l.currentTarget.scrollWidth)||l.deltaY===0||(l.currentTarget.scrollLeft+=l.deltaY+l.deltaX,l.preventDefault())}const c=pt();return Ot.mount({id:"vueuc/x-scroll",head:!0,anchorMetaName:ut,ssr:c}),Object.assign({selfRef:e,handleWheel:o},{scrollTo(...l){var y;(y=e.value)===null||y===void 0||y.scrollTo(...l)}})},render(){return d("div",{ref:"selfRef",onScroll:this.onScroll,onWheel:this.disabled?void 0:this.handleWheel,class:"v-x-scroll"},this.$slots)}});var se=function(){return vt.Date.now()},Dt="Expected a function",Mt=Math.max,Nt=Math.min;function Vt(e,o,c){var u,l,y,v,f,x,h=0,g=!1,L=!1,_=!0;if(typeof e!="function")throw new TypeError(Dt);o=ye(o)||0,ze(c)&&(g=!!c.leading,L="maxWait"in c,y=L?Mt(ye(c.maxWait)||0,o):y,_="trailing"in c?!!c.trailing:_);function w(b){var R=u,F=l;return u=l=void 0,h=b,v=e.apply(F,R),v}function z(b){return h=b,f=setTimeout(W,o),g?w(b):v}function C(b){var R=b-x,F=b-h,U=o-R;return L?Nt(U,y-F):U}function P(b){var R=b-x,F=b-h;return x===void 0||R>=o||R<0||L&&F>=y}function W(){var b=se();if(P(b))return $(b);f=setTimeout(W,C(b))}function $(b){return f=void 0,_&&u?w(b):(u=l=void 0,v)}function O(){f!==void 0&&clearTimeout(f),h=0,u=x=l=f=void 0}function E(){return f===void 0?v:$(se())}function p(){var b=se(),R=P(b);if(u=arguments,l=this,x=b,R){if(f===void 0)return z(x);if(L)return clearTimeout(f),f=setTimeout(W,o),w(x)}return f===void 0&&(f=setTimeout(W,o)),v}return p.cancel=O,p.flush=E,p}var Xt="Expected a function";function Ut(e,o,c){var u=!0,l=!0;if(typeof e!="function")throw new TypeError(Xt);return ze(c)&&(u="leading"in c?!!c.leading:u,l="trailing"in c?!!c.trailing:l),Vt(e,o,{leading:u,maxWait:o,trailing:l})}const be=ht("n-tabs"),We={tab:[String,Number,Object,Function],name:{type:[String,Number],required:!0},disabled:Boolean,displayDirective:{type:String,default:"if"},closable:{type:Boolean,default:void 0},tabProps:Object,label:[String,Number,Object,Function]},Qt=Z({__TAB_PANE__:!0,name:"TabPane",alias:["TabPanel"],props:We,slots:Object,setup(e){const o=$e(be,null);return o||gt("tab-pane","`n-tab-pane` must be placed inside `n-tabs`."),{style:o.paneStyleRef,class:o.paneClassRef,mergedClsPrefix:o.mergedClsPrefixRef}},render(){return d("div",{class:[`${this.mergedClsPrefix}-tab-pane`,this.class],style:this.style},this.$slots)}}),Gt=Object.assign({internalLeftPadded:Boolean,internalAddable:Boolean,internalCreatedByPane:Boolean},Ct(We,["displayDirective"])),ce=Z({__TAB__:!0,inheritAttrs:!1,name:"Tab",props:Gt,setup(e){const{mergedClsPrefixRef:o,valueRef:c,typeRef:u,closableRef:l,tabStyleRef:y,addTabStyleRef:v,tabClassRef:f,addTabClassRef:x,tabChangeIdRef:h,onBeforeLeaveRef:g,triggerRef:L,handleAdd:_,activateTab:w,handleClose:z}=$e(be);return{trigger:L,mergedClosable:Q(()=>{if(e.internalAddable)return!1;const{closable:C}=e;return C===void 0?l.value:C}),style:y,addStyle:v,tabClass:f,addTabClass:x,clsPrefix:o,value:c,type:u,handleClose(C){C.stopPropagation(),!e.disabled&&z(e.name)},activateTab(){if(e.disabled)return;if(e.internalAddable){_();return}const{name:C}=e,P=++h.id;if(C!==c.value){const{value:W}=g;W?Promise.resolve(W(e.name,c.value)).then($=>{$&&h.id===P&&w(C)}):w(C)}}}},render(){const{internalAddable:e,clsPrefix:o,name:c,disabled:u,label:l,tab:y,value:v,mergedClosable:f,trigger:x,$slots:{default:h}}=this,g=l??y;return d("div",{class:`${o}-tabs-tab-wrapper`},this.internalLeftPadded?d("div",{class:`${o}-tabs-tab-pad`}):null,d("div",Object.assign({key:c,"data-name":c,"data-disabled":u?!0:void 0},xt({class:[`${o}-tabs-tab`,v===c&&`${o}-tabs-tab--active`,u&&`${o}-tabs-tab--disabled`,f&&`${o}-tabs-tab--closable`,e&&`${o}-tabs-tab--addable`,e?this.addTabClass:this.tabClass],onClick:x==="click"?this.activateTab:void 0,onMouseenter:x==="hover"?this.activateTab:void 0,style:e?this.addStyle:this.style},this.internalCreatedByPane?this.tabProps||{}:this.$attrs)),d("span",{class:`${o}-tabs-tab__label`},e?d(yt,null,d("div",{class:`${o}-tabs-tab__height-placeholder`}," "),d(wt,{clsPrefix:o},{default:()=>d(It,null)})):h?h():typeof g=="object"?g:mt(g??c)),f&&this.type==="card"?d(St,{clsPrefix:o,class:`${o}-tabs-tab__close`,onClick:this.handleClose,disabled:u}):null))}}),Yt=r("tabs",`
 box-sizing: border-box;
 width: 100%;
 display: flex;
 flex-direction: column;
 transition:
 background-color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
`,[i("segment-type",[r("tabs-rail",[m("&.transition-disabled",[r("tabs-capsule",`
 transition: none;
 `)])])]),i("top",[r("tab-pane",`
 padding: var(--n-pane-padding-top) var(--n-pane-padding-right) var(--n-pane-padding-bottom) var(--n-pane-padding-left);
 `)]),i("left",[r("tab-pane",`
 padding: var(--n-pane-padding-right) var(--n-pane-padding-bottom) var(--n-pane-padding-left) var(--n-pane-padding-top);
 `)]),i("left, right",`
 flex-direction: row;
 `,[r("tabs-bar",`
 width: 2px;
 right: 0;
 transition:
 top .2s var(--n-bezier),
 max-height .2s var(--n-bezier),
 background-color .3s var(--n-bezier);
 `),r("tabs-tab",`
 padding: var(--n-tab-padding-vertical); 
 `)]),i("right",`
 flex-direction: row-reverse;
 `,[r("tab-pane",`
 padding: var(--n-pane-padding-left) var(--n-pane-padding-top) var(--n-pane-padding-right) var(--n-pane-padding-bottom);
 `),r("tabs-bar",`
 left: 0;
 `)]),i("bottom",`
 flex-direction: column-reverse;
 justify-content: flex-end;
 `,[r("tab-pane",`
 padding: var(--n-pane-padding-bottom) var(--n-pane-padding-right) var(--n-pane-padding-top) var(--n-pane-padding-left);
 `),r("tabs-bar",`
 top: 0;
 `)]),r("tabs-rail",`
 position: relative;
 padding: 3px;
 border-radius: var(--n-tab-border-radius);
 width: 100%;
 background-color: var(--n-color-segment);
 transition: background-color .3s var(--n-bezier);
 display: flex;
 align-items: center;
 `,[r("tabs-capsule",`
 border-radius: var(--n-tab-border-radius);
 position: absolute;
 pointer-events: none;
 background-color: var(--n-tab-color-segment);
 box-shadow: 0 1px 3px 0 rgba(0, 0, 0, .08);
 transition: transform 0.3s var(--n-bezier);
 `),r("tabs-tab-wrapper",`
 flex-basis: 0;
 flex-grow: 1;
 display: flex;
 align-items: center;
 justify-content: center;
 `,[r("tabs-tab",`
 overflow: hidden;
 border-radius: var(--n-tab-border-radius);
 width: 100%;
 display: flex;
 align-items: center;
 justify-content: center;
 `,[i("active",`
 font-weight: var(--n-font-weight-strong);
 color: var(--n-tab-text-color-active);
 `),m("&:hover",`
 color: var(--n-tab-text-color-hover);
 `)])])]),i("flex",[r("tabs-nav",`
 width: 100%;
 position: relative;
 `,[r("tabs-wrapper",`
 width: 100%;
 `,[r("tabs-tab",`
 margin-right: 0;
 `)])])]),r("tabs-nav",`
 box-sizing: border-box;
 line-height: 1.5;
 display: flex;
 transition: border-color .3s var(--n-bezier);
 `,[T("prefix, suffix",`
 display: flex;
 align-items: center;
 `),T("prefix","padding-right: 16px;"),T("suffix","padding-left: 16px;")]),i("top, bottom",[m(">",[r("tabs-nav",[r("tabs-nav-scroll-wrapper",[m("&::before",`
 top: 0;
 bottom: 0;
 left: 0;
 width: 20px;
 `),m("&::after",`
 top: 0;
 bottom: 0;
 right: 0;
 width: 20px;
 `),i("shadow-start",[m("&::before",`
 box-shadow: inset 10px 0 8px -8px rgba(0, 0, 0, .12);
 `)]),i("shadow-end",[m("&::after",`
 box-shadow: inset -10px 0 8px -8px rgba(0, 0, 0, .12);
 `)])])])])]),i("left, right",[r("tabs-nav-scroll-content",`
 flex-direction: column;
 `),m(">",[r("tabs-nav",[r("tabs-nav-scroll-wrapper",[m("&::before",`
 top: 0;
 left: 0;
 right: 0;
 height: 20px;
 `),m("&::after",`
 bottom: 0;
 left: 0;
 right: 0;
 height: 20px;
 `),i("shadow-start",[m("&::before",`
 box-shadow: inset 0 10px 8px -8px rgba(0, 0, 0, .12);
 `)]),i("shadow-end",[m("&::after",`
 box-shadow: inset 0 -10px 8px -8px rgba(0, 0, 0, .12);
 `)])])])])]),r("tabs-nav-scroll-wrapper",`
 flex: 1;
 position: relative;
 overflow: hidden;
 `,[r("tabs-nav-y-scroll",`
 height: 100%;
 width: 100%;
 overflow-y: auto; 
 scrollbar-width: none;
 `,[m("&::-webkit-scrollbar, &::-webkit-scrollbar-track-piece, &::-webkit-scrollbar-thumb",`
 width: 0;
 height: 0;
 display: none;
 `)]),m("&::before, &::after",`
 transition: box-shadow .3s var(--n-bezier);
 pointer-events: none;
 content: "";
 position: absolute;
 z-index: 1;
 `)]),r("tabs-nav-scroll-content",`
 display: flex;
 position: relative;
 min-width: 100%;
 min-height: 100%;
 width: fit-content;
 box-sizing: border-box;
 `),r("tabs-wrapper",`
 display: inline-flex;
 flex-wrap: nowrap;
 position: relative;
 `),r("tabs-tab-wrapper",`
 display: flex;
 flex-wrap: nowrap;
 flex-shrink: 0;
 flex-grow: 0;
 `),r("tabs-tab",`
 cursor: pointer;
 white-space: nowrap;
 flex-wrap: nowrap;
 display: inline-flex;
 align-items: center;
 color: var(--n-tab-text-color);
 font-size: var(--n-tab-font-size);
 background-clip: padding-box;
 padding: var(--n-tab-padding);
 transition:
 box-shadow .3s var(--n-bezier),
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 `,[i("disabled",{cursor:"not-allowed"}),T("close",`
 margin-left: 6px;
 transition:
 background-color .3s var(--n-bezier),
 color .3s var(--n-bezier);
 `),T("label",`
 display: flex;
 align-items: center;
 z-index: 1;
 `)]),r("tabs-bar",`
 position: absolute;
 bottom: 0;
 height: 2px;
 border-radius: 1px;
 background-color: var(--n-bar-color);
 transition:
 left .2s var(--n-bezier),
 max-width .2s var(--n-bezier),
 opacity .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 `,[m("&.transition-disabled",`
 transition: none;
 `),i("disabled",`
 background-color: var(--n-tab-text-color-disabled)
 `)]),r("tabs-pane-wrapper",`
 position: relative;
 overflow: hidden;
 transition: max-height .2s var(--n-bezier);
 `),r("tab-pane",`
 color: var(--n-pane-text-color);
 width: 100%;
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier),
 opacity .2s var(--n-bezier);
 left: 0;
 right: 0;
 top: 0;
 `,[m("&.next-transition-leave-active, &.prev-transition-leave-active, &.next-transition-enter-active, &.prev-transition-enter-active",`
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier),
 transform .2s var(--n-bezier),
 opacity .2s var(--n-bezier);
 `),m("&.next-transition-leave-active, &.prev-transition-leave-active",`
 position: absolute;
 `),m("&.next-transition-enter-from, &.prev-transition-leave-to",`
 transform: translateX(32px);
 opacity: 0;
 `),m("&.next-transition-leave-to, &.prev-transition-enter-from",`
 transform: translateX(-32px);
 opacity: 0;
 `),m("&.next-transition-leave-from, &.next-transition-enter-to, &.prev-transition-leave-from, &.prev-transition-enter-to",`
 transform: translateX(0);
 opacity: 1;
 `)]),r("tabs-tab-pad",`
 box-sizing: border-box;
 width: var(--n-tab-gap);
 flex-grow: 0;
 flex-shrink: 0;
 `),i("line-type, bar-type",[r("tabs-tab",`
 font-weight: var(--n-tab-font-weight);
 box-sizing: border-box;
 vertical-align: bottom;
 `,[m("&:hover",{color:"var(--n-tab-text-color-hover)"}),i("active",`
 color: var(--n-tab-text-color-active);
 font-weight: var(--n-tab-font-weight-active);
 `),i("disabled",{color:"var(--n-tab-text-color-disabled)"})])]),r("tabs-nav",[i("line-type",[i("top",[T("prefix, suffix",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 bottom: -1px;
 `)]),i("left",[T("prefix, suffix",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 right: -1px;
 `)]),i("right",[T("prefix, suffix",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 left: -1px;
 `)]),i("bottom",[T("prefix, suffix",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 top: -1px;
 `)]),T("prefix, suffix",`
 transition: border-color .3s var(--n-bezier);
 `),r("tabs-nav-scroll-content",`
 transition: border-color .3s var(--n-bezier);
 `),r("tabs-bar",`
 border-radius: 0;
 `)]),i("card-type",[T("prefix, suffix",`
 transition: border-color .3s var(--n-bezier);
 `),r("tabs-pad",`
 flex-grow: 1;
 transition: border-color .3s var(--n-bezier);
 `),r("tabs-tab-pad",`
 transition: border-color .3s var(--n-bezier);
 `),r("tabs-tab",`
 font-weight: var(--n-tab-font-weight);
 border: 1px solid var(--n-tab-border-color);
 background-color: var(--n-tab-color);
 box-sizing: border-box;
 position: relative;
 vertical-align: bottom;
 display: flex;
 justify-content: space-between;
 font-size: var(--n-tab-font-size);
 color: var(--n-tab-text-color);
 `,[i("addable",`
 padding-left: 8px;
 padding-right: 8px;
 font-size: 16px;
 justify-content: center;
 `,[T("height-placeholder",`
 width: 0;
 font-size: var(--n-tab-font-size);
 `),Rt("disabled",[m("&:hover",`
 color: var(--n-tab-text-color-hover);
 `)])]),i("closable","padding-right: 8px;"),i("active",`
 background-color: #0000;
 font-weight: var(--n-tab-font-weight-active);
 color: var(--n-tab-text-color-active);
 `),i("disabled","color: var(--n-tab-text-color-disabled);")])]),i("left, right",`
 flex-direction: column; 
 `,[T("prefix, suffix",`
 padding: var(--n-tab-padding-vertical);
 `),r("tabs-wrapper",`
 flex-direction: column;
 `),r("tabs-tab-wrapper",`
 flex-direction: column;
 `,[r("tabs-tab-pad",`
 height: var(--n-tab-gap-vertical);
 width: 100%;
 `)])]),i("top",[i("card-type",[r("tabs-scroll-padding","border-bottom: 1px solid var(--n-tab-border-color);"),T("prefix, suffix",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-top-left-radius: var(--n-tab-border-radius);
 border-top-right-radius: var(--n-tab-border-radius);
 `,[i("active",`
 border-bottom: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `)])]),i("left",[i("card-type",[r("tabs-scroll-padding","border-right: 1px solid var(--n-tab-border-color);"),T("prefix, suffix",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-top-left-radius: var(--n-tab-border-radius);
 border-bottom-left-radius: var(--n-tab-border-radius);
 `,[i("active",`
 border-right: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-right: 1px solid var(--n-tab-border-color);
 `)])]),i("right",[i("card-type",[r("tabs-scroll-padding","border-left: 1px solid var(--n-tab-border-color);"),T("prefix, suffix",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-top-right-radius: var(--n-tab-border-radius);
 border-bottom-right-radius: var(--n-tab-border-radius);
 `,[i("active",`
 border-left: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-left: 1px solid var(--n-tab-border-color);
 `)])]),i("bottom",[i("card-type",[r("tabs-scroll-padding","border-top: 1px solid var(--n-tab-border-color);"),T("prefix, suffix",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-bottom-left-radius: var(--n-tab-border-radius);
 border-bottom-right-radius: var(--n-tab-border-radius);
 `,[i("active",`
 border-top: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-top: 1px solid var(--n-tab-border-color);
 `)])])])]),le=Ut,qt=Object.assign(Object.assign({},Pe.props),{value:[String,Number],defaultValue:[String,Number],trigger:{type:String,default:"click"},type:{type:String,default:"bar"},closable:Boolean,justifyContent:String,size:{type:String,default:"medium"},placement:{type:String,default:"top"},tabStyle:[String,Object],tabClass:String,addTabStyle:[String,Object],addTabClass:String,barWidth:Number,paneClass:String,paneStyle:[String,Object],paneWrapperClass:String,paneWrapperStyle:[String,Object],addable:[Boolean,Object],tabsPadding:{type:Number,default:0},animated:Boolean,onBeforeLeave:Function,onAdd:Function,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onClose:[Function,Array],labelSize:String,activeName:[String,Number],onActiveNameChange:[Function,Array]}),Zt=Z({name:"Tabs",props:qt,slots:Object,setup(e,{slots:o}){var c,u,l,y;const{mergedClsPrefixRef:v,inlineThemeDisabled:f}=Tt(e),x=Pe("Tabs","-tabs",Yt,zt,e,v),h=A(null),g=A(null),L=A(null),_=A(null),w=A(null),z=A(null),C=A(!0),P=A(!0),W=Se(e,["labelSize","size"]),$=Se(e,["activeName","value"]),O=A((u=(c=$.value)!==null&&c!==void 0?c:e.defaultValue)!==null&&u!==void 0?u:o.default?(y=(l=re(o.default())[0])===null||l===void 0?void 0:l.props)===null||y===void 0?void 0:y.name:null),E=$t($,O),p={id:0},b=Q(()=>{if(!(!e.justifyContent||e.type==="card"))return{display:"flex",justifyContent:e.justifyContent}});oe(E,()=>{p.id=0,G(),pe()});function R(){var t;const{value:a}=E;return a===null?null:(t=h.value)===null||t===void 0?void 0:t.querySelector(`[data-name="${a}"]`)}function F(t){if(e.type==="card")return;const{value:a}=g;if(!a)return;const n=a.style.opacity==="0";if(t){const s=`${v.value}-tabs-bar--disabled`,{barWidth:S,placement:B}=e;if(t.dataset.disabled==="true"?a.classList.add(s):a.classList.remove(s),["top","bottom"].includes(B)){if(fe(["top","maxHeight","height"]),typeof S=="number"&&t.offsetWidth>=S){const k=Math.floor((t.offsetWidth-S)/2)+t.offsetLeft;a.style.left=`${k}px`,a.style.maxWidth=`${S}px`}else a.style.left=`${t.offsetLeft}px`,a.style.maxWidth=`${t.offsetWidth}px`;a.style.width="8192px",n&&(a.style.transition="none"),a.offsetWidth,n&&(a.style.transition="",a.style.opacity="1")}else{if(fe(["left","maxWidth","width"]),typeof S=="number"&&t.offsetHeight>=S){const k=Math.floor((t.offsetHeight-S)/2)+t.offsetTop;a.style.top=`${k}px`,a.style.maxHeight=`${S}px`}else a.style.top=`${t.offsetTop}px`,a.style.maxHeight=`${t.offsetHeight}px`;a.style.height="8192px",n&&(a.style.transition="none"),a.offsetHeight,n&&(a.style.transition="",a.style.opacity="1")}}}function U(){if(e.type==="card")return;const{value:t}=g;t&&(t.style.opacity="0")}function fe(t){const{value:a}=g;if(a)for(const n of t)a.style[n]=""}function G(){if(e.type==="card")return;const t=R();t?F(t):U()}function pe(){var t;const a=(t=w.value)===null||t===void 0?void 0:t.$el;if(!a)return;const n=R();if(!n)return;const{scrollLeft:s,offsetWidth:S}=a,{offsetLeft:B,offsetWidth:k}=n;s>B?a.scrollTo({top:0,left:B,behavior:"smooth"}):B+k>s+S&&a.scrollTo({top:0,left:B+k-S,behavior:"smooth"})}const Y=A(null);let ee=0,I=null;function Le(t){const a=Y.value;if(a){ee=t.getBoundingClientRect().height;const n=`${ee}px`,s=()=>{a.style.height=n,a.style.maxHeight=n};I?(s(),I(),I=null):I=s}}function _e(t){const a=Y.value;if(a){const n=t.getBoundingClientRect().height,s=()=>{document.body.offsetHeight,a.style.maxHeight=`${n}px`,a.style.height=`${Math.max(ee,n)}px`};I?(I(),I=null,s()):I=s}}function Ee(){const t=Y.value;if(t){t.style.maxHeight="",t.style.height="";const{paneWrapperStyle:a}=e;if(typeof a=="string")t.style.cssText=a;else if(a){const{maxHeight:n,height:s}=a;n!==void 0&&(t.style.maxHeight=n),s!==void 0&&(t.style.height=s)}}}const ue={value:[]},ve=A("next");function Ae(t){const a=E.value;let n="next";for(const s of ue.value){if(s===a)break;if(s===t){n="prev";break}}ve.value=n,Be(t)}function Be(t){const{onActiveNameChange:a,onUpdateValue:n,"onUpdate:value":s}=e;a&&J(a,t),n&&J(n,t),s&&J(s,t),O.value=t}function ke(t){const{onClose:a}=e;a&&J(a,t)}function he(){const{value:t}=g;if(!t)return;const a="transition-disabled";t.classList.add(a),G(),t.classList.remove(a)}const D=A(null);function te({transitionDisabled:t}){const a=h.value;if(!a)return;t&&a.classList.add("transition-disabled");const n=R();n&&D.value&&(D.value.style.width=`${n.offsetWidth}px`,D.value.style.height=`${n.offsetHeight}px`,D.value.style.transform=`translateX(${n.offsetLeft-At(getComputedStyle(a).paddingLeft)}px)`,t&&D.value.offsetWidth),t&&a.classList.remove("transition-disabled")}oe([E],()=>{e.type==="segment"&&ie(()=>{te({transitionDisabled:!1})})}),Pt(()=>{e.type==="segment"&&te({transitionDisabled:!0})});let ge=0;function je(t){var a;if(t.contentRect.width===0&&t.contentRect.height===0||ge===t.contentRect.width)return;ge=t.contentRect.width;const{type:n}=e;if((n==="line"||n==="bar")&&he(),n!=="segment"){const{placement:s}=e;ae((s==="top"||s==="bottom"?(a=w.value)===null||a===void 0?void 0:a.$el:z.value)||null)}}const He=le(je,64);oe([()=>e.justifyContent,()=>e.size],()=>{ie(()=>{const{type:t}=e;(t==="line"||t==="bar")&&he()})});const M=A(!1);function Ie(t){var a;const{target:n,contentRect:{width:s,height:S}}=t,B=n.parentElement.parentElement.offsetWidth,k=n.parentElement.parentElement.offsetHeight,{placement:V}=e;if(!M.value)V==="top"||V==="bottom"?B<s&&(M.value=!0):k<S&&(M.value=!0);else{const{value:X}=_;if(!X)return;V==="top"||V==="bottom"?B-s>X.$el.offsetWidth&&(M.value=!1):k-S>X.$el.offsetHeight&&(M.value=!1)}ae(((a=w.value)===null||a===void 0?void 0:a.$el)||null)}const Oe=le(Ie,64);function Fe(){const{onAdd:t}=e;t&&t(),ie(()=>{const a=R(),{value:n}=w;!a||!n||n.scrollTo({left:a.offsetLeft,top:0,behavior:"smooth"})})}function ae(t){if(!t)return;const{placement:a}=e;if(a==="top"||a==="bottom"){const{scrollLeft:n,scrollWidth:s,offsetWidth:S}=t;C.value=n<=0,P.value=n+S>=s}else{const{scrollTop:n,scrollHeight:s,offsetHeight:S}=t;C.value=n<=0,P.value=n+S>=s}}const De=le(t=>{ae(t.target)},64);Wt(be,{triggerRef:j(e,"trigger"),tabStyleRef:j(e,"tabStyle"),tabClassRef:j(e,"tabClass"),addTabStyleRef:j(e,"addTabStyle"),addTabClassRef:j(e,"addTabClass"),paneClassRef:j(e,"paneClass"),paneStyleRef:j(e,"paneStyle"),mergedClsPrefixRef:v,typeRef:j(e,"type"),closableRef:j(e,"closable"),valueRef:E,tabChangeIdRef:p,onBeforeLeaveRef:j(e,"onBeforeLeave"),activateTab:Ae,handleClose:ke,handleAdd:Fe}),Lt(()=>{G(),pe()}),_t(()=>{const{value:t}=L;if(!t)return;const{value:a}=v,n=`${a}-tabs-nav-scroll-wrapper--shadow-start`,s=`${a}-tabs-nav-scroll-wrapper--shadow-end`;C.value?t.classList.remove(n):t.classList.add(n),P.value?t.classList.remove(s):t.classList.add(s)});const Me={syncBarPosition:()=>{G()}},Ne=()=>{te({transitionDisabled:!0})},xe=Q(()=>{const{value:t}=W,{type:a}=e,n={card:"Card",bar:"Bar",line:"Line",segment:"Segment"}[a],s=`${t}${n}`,{self:{barColor:S,closeIconColor:B,closeIconColorHover:k,closeIconColorPressed:V,tabColor:X,tabBorderColor:Ve,paneTextColor:Xe,tabFontWeight:Ue,tabBorderRadius:Ge,tabFontWeightActive:Ye,colorSegment:qe,fontWeightStrong:Ke,tabColorSegment:Je,closeSize:Qe,closeIconSize:Ze,closeColorHover:et,closeColorPressed:tt,closeBorderRadius:at,[H("panePadding",t)]:q,[H("tabPadding",s)]:rt,[H("tabPaddingVertical",s)]:nt,[H("tabGap",s)]:ot,[H("tabGap",`${s}Vertical`)]:it,[H("tabTextColor",a)]:st,[H("tabTextColorActive",a)]:lt,[H("tabTextColorHover",a)]:dt,[H("tabTextColorDisabled",a)]:ct,[H("tabFontSize",t)]:bt},common:{cubicBezierEaseInOut:ft}}=x.value;return{"--n-bezier":ft,"--n-color-segment":qe,"--n-bar-color":S,"--n-tab-font-size":bt,"--n-tab-text-color":st,"--n-tab-text-color-active":lt,"--n-tab-text-color-disabled":ct,"--n-tab-text-color-hover":dt,"--n-pane-text-color":Xe,"--n-tab-border-color":Ve,"--n-tab-border-radius":Ge,"--n-close-size":Qe,"--n-close-icon-size":Ze,"--n-close-color-hover":et,"--n-close-color-pressed":tt,"--n-close-border-radius":at,"--n-close-icon-color":B,"--n-close-icon-color-hover":k,"--n-close-icon-color-pressed":V,"--n-tab-color":X,"--n-tab-font-weight":Ue,"--n-tab-font-weight-active":Ye,"--n-tab-padding":rt,"--n-tab-padding-vertical":nt,"--n-tab-gap":ot,"--n-tab-gap-vertical":it,"--n-pane-padding-left":K(q,"left"),"--n-pane-padding-right":K(q,"right"),"--n-pane-padding-top":K(q,"top"),"--n-pane-padding-bottom":K(q,"bottom"),"--n-font-weight-strong":Ke,"--n-tab-color-segment":Je}}),N=f?Et("tabs",Q(()=>`${W.value[0]}${e.type[0]}`),xe,e):void 0;return Object.assign({mergedClsPrefix:v,mergedValue:E,renderedNames:new Set,segmentCapsuleElRef:D,tabsPaneWrapperRef:Y,tabsElRef:h,barElRef:g,addTabInstRef:_,xScrollInstRef:w,scrollWrapperElRef:L,addTabFixed:M,tabWrapperStyle:b,handleNavResize:He,mergedSize:W,handleScroll:De,handleTabsResize:Oe,cssVars:f?void 0:xe,themeClass:N?.themeClass,animationDirection:ve,renderNameListRef:ue,yScrollElRef:z,handleSegmentResize:Ne,onAnimationBeforeLeave:Le,onAnimationEnter:_e,onAnimationAfterEnter:Ee,onRender:N?.onRender},Me)},render(){const{mergedClsPrefix:e,type:o,placement:c,addTabFixed:u,addable:l,mergedSize:y,renderNameListRef:v,onRender:f,paneWrapperClass:x,paneWrapperStyle:h,$slots:{default:g,prefix:L,suffix:_}}=this;f?.();const w=g?re(g()).filter(p=>p.type.__TAB_PANE__===!0):[],z=g?re(g()).filter(p=>p.type.__TAB__===!0):[],C=!z.length,P=o==="card",W=o==="segment",$=!P&&!W&&this.justifyContent;v.value=[];const O=()=>{const p=d("div",{style:this.tabWrapperStyle,class:`${e}-tabs-wrapper`},$?null:d("div",{class:`${e}-tabs-scroll-padding`,style:c==="top"||c==="bottom"?{width:`${this.tabsPadding}px`}:{height:`${this.tabsPadding}px`}}),C?w.map((b,R)=>(v.value.push(b.props.name),de(d(ce,Object.assign({},b.props,{internalCreatedByPane:!0,internalLeftPadded:R!==0&&(!$||$==="center"||$==="start"||$==="end")}),b.children?{default:b.children.tab}:void 0)))):z.map((b,R)=>(v.value.push(b.props.name),de(R!==0&&!$?Te(b):b))),!u&&l&&P?Re(l,(C?w.length:z.length)!==0):null,$?null:d("div",{class:`${e}-tabs-scroll-padding`,style:{width:`${this.tabsPadding}px`}}));return d("div",{ref:"tabsElRef",class:`${e}-tabs-nav-scroll-content`},P&&l?d(ne,{onResize:this.handleTabsResize},{default:()=>p}):p,P?d("div",{class:`${e}-tabs-pad`}):null,P?null:d("div",{ref:"barElRef",class:`${e}-tabs-bar`}))},E=W?"top":c;return d("div",{class:[`${e}-tabs`,this.themeClass,`${e}-tabs--${o}-type`,`${e}-tabs--${y}-size`,$&&`${e}-tabs--flex`,`${e}-tabs--${E}`],style:this.cssVars},d("div",{class:[`${e}-tabs-nav--${o}-type`,`${e}-tabs-nav--${E}`,`${e}-tabs-nav`]},we(L,p=>p&&d("div",{class:`${e}-tabs-nav__prefix`},p)),W?d(ne,{onResize:this.handleSegmentResize},{default:()=>d("div",{class:`${e}-tabs-rail`,ref:"tabsElRef"},d("div",{class:`${e}-tabs-capsule`,ref:"segmentCapsuleElRef"},d("div",{class:`${e}-tabs-wrapper`},d("div",{class:`${e}-tabs-tab`}))),C?w.map((p,b)=>(v.value.push(p.props.name),d(ce,Object.assign({},p.props,{internalCreatedByPane:!0,internalLeftPadded:b!==0}),p.children?{default:p.children.tab}:void 0))):z.map((p,b)=>(v.value.push(p.props.name),b===0?p:Te(p))))}):d(ne,{onResize:this.handleNavResize},{default:()=>d("div",{class:`${e}-tabs-nav-scroll-wrapper`,ref:"scrollWrapperElRef"},["top","bottom"].includes(E)?d(Ft,{ref:"xScrollInstRef",onScroll:this.handleScroll},{default:O}):d("div",{class:`${e}-tabs-nav-y-scroll`,onScroll:this.handleScroll,ref:"yScrollElRef"},O()))}),u&&l&&P?Re(l,!0):null,we(_,p=>p&&d("div",{class:`${e}-tabs-nav__suffix`},p))),C&&(this.animated&&(E==="top"||E==="bottom")?d("div",{ref:"tabsPaneWrapperRef",style:h,class:[`${e}-tabs-pane-wrapper`,x]},Ce(w,this.mergedValue,this.renderedNames,this.onAnimationBeforeLeave,this.onAnimationEnter,this.onAnimationAfterEnter,this.animationDirection)):Ce(w,this.mergedValue,this.renderedNames)))}});function Ce(e,o,c,u,l,y,v){const f=[];return e.forEach(x=>{const{name:h,displayDirective:g,"display-directive":L}=x.props,_=z=>g===z||L===z,w=o===h;if(x.key!==void 0&&(x.key=h),w||_("show")||_("show:lazy")&&c.has(h)){c.has(h)||c.add(h);const z=!_("if");f.push(z?Bt(x,[[Ht,w]]):x)}}),v?d(kt,{name:`${v}-transition`,onBeforeLeave:u,onEnter:l,onAfterEnter:y},{default:()=>f}):f}function Re(e,o){return d(ce,{ref:"addTabInstRef",key:"__addable",name:"__addable",internalCreatedByPane:!0,internalAddable:!0,internalLeftPadded:o,disabled:typeof e=="object"&&e.disabled})}function Te(e){const o=jt(e);return o.props?o.props.internalLeftPadded=!0:o.props={internalLeftPadded:!0},o}function de(e){return Array.isArray(e.dynamicProps)?e.dynamicProps.includes("internalLeftPadded")||e.dynamicProps.push("internalLeftPadded"):e.dynamicProps=["internalLeftPadded"],e}export{Zt as N,Qt as a};
