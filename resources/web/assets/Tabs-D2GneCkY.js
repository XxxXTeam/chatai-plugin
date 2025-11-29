import{d as J,h as b,r as E,aJ as vt,aK as we,aL as gt,D as pe,l as I,aM as mt,aN as xt,aO as $e,aP as je,M as yt,e as $,c as r,b as l,f as _,u as Pe,X as _e,ar as G,x as k,n as ne,q as We,s as wt,E as $t,aQ as Ct,aR as St,az as Rt,G as zt,aS as Tt,aT as jt,a as Pt,aU as se,I as Ce,aV as le,aW as _t,aD as Se,m as Wt,p as Lt,aX as Et,aY as Bt,aC as N,aZ as te,a_ as kt,w as At,y as Ht,a$ as Nt,b0 as Ot,aw as de,t as ae}from"./index-D5XyPjkW.js";import{A as It}from"./Switch-BxYuU8DT.js";const Ft=we(".v-x-scroll",{overflow:"auto",scrollbarWidth:"none"},[we("&::-webkit-scrollbar",{width:0,height:0})]),Mt=J({name:"XScroll",props:{disabled:Boolean,onScroll:Function},setup(){const e=E(null);function t(s){!(s.currentTarget.offsetWidth<s.currentTarget.scrollWidth)||s.deltaY===0||(s.currentTarget.scrollLeft+=s.deltaY+s.deltaX,s.preventDefault())}const i=vt();return Ft.mount({id:"vueuc/x-scroll",head:!0,anchorMetaName:gt,ssr:i}),Object.assign({selfRef:e,handleWheel:t},{scrollTo(...s){var g;(g=e.value)===null||g===void 0||g.scrollTo(...s)}})},render(){return b("div",{ref:"selfRef",onScroll:this.onScroll,onWheel:this.disabled?void 0:this.handleWheel,class:"v-x-scroll"},this.$slots)}});function Dt(e,t){const i=pe(mt,null);return I(()=>e.hljs||i?.mergedHljsRef.value)}var ce=function(){return xt.Date.now()},Vt="Expected a function",Xt=Math.max,Ut=Math.min;function qt(e,t,i){var u,s,g,m,h,R,x=0,C=!1,W=!1,z=!0;if(typeof e!="function")throw new TypeError(Vt);t=$e(t)||0,je(i)&&(C=!!i.leading,W="maxWait"in i,g=W?Xt($e(i.maxWait)||0,t):g,z="trailing"in i?!!i.trailing:z);function d(f){var P=u,O=s;return u=s=void 0,x=f,m=e.apply(O,P),m}function y(f){return x=f,h=setTimeout(S,t),C?d(f):m}function p(f){var P=f-R,O=f-x,M=t-P;return W?Ut(M,g-O):M}function w(f){var P=f-R,O=f-x;return R===void 0||P>=t||P<0||W&&O>=g}function S(){var f=ce();if(w(f))return T(f);h=setTimeout(S,p(f))}function T(f){return h=void 0,z&&u?d(f):(u=s=void 0,m)}function B(){h!==void 0&&clearTimeout(h),x=0,u=R=s=h=void 0}function L(){return h===void 0?m:T(ce())}function v(){var f=ce(),P=w(f);if(u=arguments,s=this,R=f,P){if(h===void 0)return y(R);if(W)return clearTimeout(h),h=setTimeout(S,t),d(R)}return h===void 0&&(h=setTimeout(S,t)),m}return v.cancel=B,v.flush=L,v}var Gt="Expected a function";function Kt(e,t,i){var u=!0,s=!0;if(typeof e!="function")throw new TypeError(Gt);return je(i)&&(u="leading"in i?!!i.leading:u,s="trailing"in i?!!i.trailing:s),qt(e,t,{leading:u,maxWait:t,trailing:s})}function Yt(e){const{textColor2:t,fontSize:i,fontWeightStrong:u,textColor3:s}=e;return{textColor:t,fontSize:i,fontWeightStrong:u,"mono-3":"#a0a1a7","hue-1":"#0184bb","hue-2":"#4078f2","hue-3":"#a626a4","hue-4":"#50a14f","hue-5":"#e45649","hue-5-2":"#c91243","hue-6":"#986801","hue-6-2":"#c18401",lineNumberTextColor:s}}const Jt={common:yt,self:Yt},Qt=$([r("code",`
 font-size: var(--n-font-size);
 font-family: var(--n-font-family);
 `,[l("show-line-numbers",`
 display: flex;
 `),_("line-numbers",`
 user-select: none;
 padding-right: 12px;
 text-align: right;
 transition: color .3s var(--n-bezier);
 color: var(--n-line-number-text-color);
 `),l("word-wrap",[$("pre",`
 white-space: pre-wrap;
 word-break: break-all;
 `)]),$("pre",`
 margin: 0;
 line-height: inherit;
 font-size: inherit;
 font-family: inherit;
 `),$("[class^=hljs]",`
 color: var(--n-text-color);
 transition: 
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 `)]),({props:e})=>{const t=`${e.bPrefix}code`;return[`${t} .hljs-comment,
 ${t} .hljs-quote {
 color: var(--n-mono-3);
 font-style: italic;
 }`,`${t} .hljs-doctag,
 ${t} .hljs-keyword,
 ${t} .hljs-formula {
 color: var(--n-hue-3);
 }`,`${t} .hljs-section,
 ${t} .hljs-name,
 ${t} .hljs-selector-tag,
 ${t} .hljs-deletion,
 ${t} .hljs-subst {
 color: var(--n-hue-5);
 }`,`${t} .hljs-literal {
 color: var(--n-hue-1);
 }`,`${t} .hljs-string,
 ${t} .hljs-regexp,
 ${t} .hljs-addition,
 ${t} .hljs-attribute,
 ${t} .hljs-meta-string {
 color: var(--n-hue-4);
 }`,`${t} .hljs-built_in,
 ${t} .hljs-class .hljs-title {
 color: var(--n-hue-6-2);
 }`,`${t} .hljs-attr,
 ${t} .hljs-variable,
 ${t} .hljs-template-variable,
 ${t} .hljs-type,
 ${t} .hljs-selector-class,
 ${t} .hljs-selector-attr,
 ${t} .hljs-selector-pseudo,
 ${t} .hljs-number {
 color: var(--n-hue-6);
 }`,`${t} .hljs-symbol,
 ${t} .hljs-bullet,
 ${t} .hljs-link,
 ${t} .hljs-meta,
 ${t} .hljs-selector-id,
 ${t} .hljs-title {
 color: var(--n-hue-2);
 }`,`${t} .hljs-emphasis {
 font-style: italic;
 }`,`${t} .hljs-strong {
 font-weight: var(--n-font-weight-strong);
 }`,`${t} .hljs-link {
 text-decoration: underline;
 }`]}]),Zt=Object.assign(Object.assign({},ne.props),{language:String,code:{type:String,default:""},trim:{type:Boolean,default:!0},hljs:Object,uri:Boolean,inline:Boolean,wordWrap:Boolean,showLineNumbers:Boolean,internalFontSize:Number,internalNoHighlight:Boolean}),oa=J({name:"Code",props:Zt,setup(e,{slots:t}){const{internalNoHighlight:i}=e,{mergedClsPrefixRef:u,inlineThemeDisabled:s}=Pe(),g=E(null),m=i?{value:void 0}:Dt(e),h=(d,y,p)=>{const{value:w}=m;return!w||!(d&&w.getLanguage(d))?null:w.highlight(p?y.trim():y,{language:d}).value},R=I(()=>e.inline||e.wordWrap?!1:e.showLineNumbers),x=()=>{if(t.default)return;const{value:d}=g;if(!d)return;const{language:y}=e,p=e.uri?window.decodeURIComponent(e.code):e.code;if(y){const S=h(y,p,e.trim);if(S!==null){if(e.inline)d.innerHTML=S;else{const T=d.querySelector(".__code__");T&&d.removeChild(T);const B=document.createElement("pre");B.className="__code__",B.innerHTML=S,d.appendChild(B)}return}}if(e.inline){d.textContent=p;return}const w=d.querySelector(".__code__");if(w)w.textContent=p;else{const S=document.createElement("pre");S.className="__code__",S.textContent=p,d.innerHTML="",d.appendChild(S)}};_e(x),G(k(e,"language"),x),G(k(e,"code"),x),i||G(m,x);const C=ne("Code","-code",Qt,Jt,e,u),W=I(()=>{const{common:{cubicBezierEaseInOut:d,fontFamilyMono:y},self:{textColor:p,fontSize:w,fontWeightStrong:S,lineNumberTextColor:T,"mono-3":B,"hue-1":L,"hue-2":v,"hue-3":f,"hue-4":P,"hue-5":O,"hue-5-2":M,"hue-6":Q,"hue-6-2":D}}=C.value,{internalFontSize:K}=e;return{"--n-font-size":K?`${K}px`:w,"--n-font-family":y,"--n-font-weight-strong":S,"--n-bezier":d,"--n-text-color":p,"--n-mono-3":B,"--n-hue-1":L,"--n-hue-2":v,"--n-hue-3":f,"--n-hue-4":P,"--n-hue-5":O,"--n-hue-5-2":M,"--n-hue-6":Q,"--n-hue-6-2":D,"--n-line-number-text-color":T}}),z=s?We("code",I(()=>`${e.internalFontSize||"a"}`),W,e):void 0;return{mergedClsPrefix:u,codeRef:g,mergedShowLineNumbers:R,lineNumbers:I(()=>{let d=1;const y=[];let p=!1;for(const w of e.code)w===`
`?(p=!0,y.push(d++)):p=!1;return p||y.push(d++),y.join(`
`)}),cssVars:s?void 0:W,themeClass:z?.themeClass,onRender:z?.onRender}},render(){var e,t;const{mergedClsPrefix:i,wordWrap:u,mergedShowLineNumbers:s,onRender:g}=this;return g?.(),b("code",{class:[`${i}-code`,this.themeClass,u&&`${i}-code--word-wrap`,s&&`${i}-code--show-line-numbers`],style:this.cssVars,ref:"codeRef"},s?b("pre",{class:`${i}-code__line-numbers`},this.lineNumbers):null,(t=(e=this.$slots).default)===null||t===void 0?void 0:t.call(e))}}),he=wt("n-tabs"),Le={tab:[String,Number,Object,Function],name:{type:[String,Number],required:!0},disabled:Boolean,displayDirective:{type:String,default:"if"},closable:{type:Boolean,default:void 0},tabProps:Object,label:[String,Number,Object,Function]},ia=J({__TAB_PANE__:!0,name:"TabPane",alias:["TabPanel"],props:Le,slots:Object,setup(e){const t=pe(he,null);return t||$t("tab-pane","`n-tab-pane` must be placed inside `n-tabs`."),{style:t.paneStyleRef,class:t.paneClassRef,mergedClsPrefix:t.mergedClsPrefixRef}},render(){return b("div",{class:[`${this.mergedClsPrefix}-tab-pane`,this.class],style:this.style},this.$slots)}}),ea=Object.assign({internalLeftPadded:Boolean,internalAddable:Boolean,internalCreatedByPane:Boolean},jt(Le,["displayDirective"])),ue=J({__TAB__:!0,inheritAttrs:!1,name:"Tab",props:ea,setup(e){const{mergedClsPrefixRef:t,valueRef:i,typeRef:u,closableRef:s,tabStyleRef:g,addTabStyleRef:m,tabClassRef:h,addTabClassRef:R,tabChangeIdRef:x,onBeforeLeaveRef:C,triggerRef:W,handleAdd:z,activateTab:d,handleClose:y}=pe(he);return{trigger:W,mergedClosable:I(()=>{if(e.internalAddable)return!1;const{closable:p}=e;return p===void 0?s.value:p}),style:g,addStyle:m,tabClass:h,addTabClass:R,clsPrefix:t,value:i,type:u,handleClose(p){p.stopPropagation(),!e.disabled&&y(e.name)},activateTab(){if(e.disabled)return;if(e.internalAddable){z();return}const{name:p}=e,w=++x.id;if(p!==i.value){const{value:S}=C;S?Promise.resolve(S(e.name,i.value)).then(T=>{T&&x.id===w&&d(p)}):d(p)}}}},render(){const{internalAddable:e,clsPrefix:t,name:i,disabled:u,label:s,tab:g,value:m,mergedClosable:h,trigger:R,$slots:{default:x}}=this,C=s??g;return b("div",{class:`${t}-tabs-tab-wrapper`},this.internalLeftPadded?b("div",{class:`${t}-tabs-tab-pad`}):null,b("div",Object.assign({key:i,"data-name":i,"data-disabled":u?!0:void 0},Ct({class:[`${t}-tabs-tab`,m===i&&`${t}-tabs-tab--active`,u&&`${t}-tabs-tab--disabled`,h&&`${t}-tabs-tab--closable`,e&&`${t}-tabs-tab--addable`,e?this.addTabClass:this.tabClass],onClick:R==="click"?this.activateTab:void 0,onMouseenter:R==="hover"?this.activateTab:void 0,style:e?this.addStyle:this.style},this.internalCreatedByPane?this.tabProps||{}:this.$attrs)),b("span",{class:`${t}-tabs-tab__label`},e?b(Rt,null,b("div",{class:`${t}-tabs-tab__height-placeholder`}," "),b(zt,{clsPrefix:t},{default:()=>b(It,null)})):x?x():typeof C=="object"?C:St(C??i)),h&&this.type==="card"?b(Tt,{clsPrefix:t,class:`${t}-tabs-tab__close`,onClick:this.handleClose,disabled:u}):null))}}),ta=r("tabs",`
 box-sizing: border-box;
 width: 100%;
 display: flex;
 flex-direction: column;
 transition:
 background-color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
`,[l("segment-type",[r("tabs-rail",[$("&.transition-disabled",[r("tabs-capsule",`
 transition: none;
 `)])])]),l("top",[r("tab-pane",`
 padding: var(--n-pane-padding-top) var(--n-pane-padding-right) var(--n-pane-padding-bottom) var(--n-pane-padding-left);
 `)]),l("left",[r("tab-pane",`
 padding: var(--n-pane-padding-right) var(--n-pane-padding-bottom) var(--n-pane-padding-left) var(--n-pane-padding-top);
 `)]),l("left, right",`
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
 `)]),l("right",`
 flex-direction: row-reverse;
 `,[r("tab-pane",`
 padding: var(--n-pane-padding-left) var(--n-pane-padding-top) var(--n-pane-padding-right) var(--n-pane-padding-bottom);
 `),r("tabs-bar",`
 left: 0;
 `)]),l("bottom",`
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
 `,[l("active",`
 font-weight: var(--n-font-weight-strong);
 color: var(--n-tab-text-color-active);
 `),$("&:hover",`
 color: var(--n-tab-text-color-hover);
 `)])])]),l("flex",[r("tabs-nav",`
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
 `,[_("prefix, suffix",`
 display: flex;
 align-items: center;
 `),_("prefix","padding-right: 16px;"),_("suffix","padding-left: 16px;")]),l("top, bottom",[$(">",[r("tabs-nav",[r("tabs-nav-scroll-wrapper",[$("&::before",`
 top: 0;
 bottom: 0;
 left: 0;
 width: 20px;
 `),$("&::after",`
 top: 0;
 bottom: 0;
 right: 0;
 width: 20px;
 `),l("shadow-start",[$("&::before",`
 box-shadow: inset 10px 0 8px -8px rgba(0, 0, 0, .12);
 `)]),l("shadow-end",[$("&::after",`
 box-shadow: inset -10px 0 8px -8px rgba(0, 0, 0, .12);
 `)])])])])]),l("left, right",[r("tabs-nav-scroll-content",`
 flex-direction: column;
 `),$(">",[r("tabs-nav",[r("tabs-nav-scroll-wrapper",[$("&::before",`
 top: 0;
 left: 0;
 right: 0;
 height: 20px;
 `),$("&::after",`
 bottom: 0;
 left: 0;
 right: 0;
 height: 20px;
 `),l("shadow-start",[$("&::before",`
 box-shadow: inset 0 10px 8px -8px rgba(0, 0, 0, .12);
 `)]),l("shadow-end",[$("&::after",`
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
 `,[$("&::-webkit-scrollbar, &::-webkit-scrollbar-track-piece, &::-webkit-scrollbar-thumb",`
 width: 0;
 height: 0;
 display: none;
 `)]),$("&::before, &::after",`
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
 `,[l("disabled",{cursor:"not-allowed"}),_("close",`
 margin-left: 6px;
 transition:
 background-color .3s var(--n-bezier),
 color .3s var(--n-bezier);
 `),_("label",`
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
 `,[$("&.transition-disabled",`
 transition: none;
 `),l("disabled",`
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
 `,[$("&.next-transition-leave-active, &.prev-transition-leave-active, &.next-transition-enter-active, &.prev-transition-enter-active",`
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier),
 transform .2s var(--n-bezier),
 opacity .2s var(--n-bezier);
 `),$("&.next-transition-leave-active, &.prev-transition-leave-active",`
 position: absolute;
 `),$("&.next-transition-enter-from, &.prev-transition-leave-to",`
 transform: translateX(32px);
 opacity: 0;
 `),$("&.next-transition-leave-to, &.prev-transition-enter-from",`
 transform: translateX(-32px);
 opacity: 0;
 `),$("&.next-transition-leave-from, &.next-transition-enter-to, &.prev-transition-leave-from, &.prev-transition-enter-to",`
 transform: translateX(0);
 opacity: 1;
 `)]),r("tabs-tab-pad",`
 box-sizing: border-box;
 width: var(--n-tab-gap);
 flex-grow: 0;
 flex-shrink: 0;
 `),l("line-type, bar-type",[r("tabs-tab",`
 font-weight: var(--n-tab-font-weight);
 box-sizing: border-box;
 vertical-align: bottom;
 `,[$("&:hover",{color:"var(--n-tab-text-color-hover)"}),l("active",`
 color: var(--n-tab-text-color-active);
 font-weight: var(--n-tab-font-weight-active);
 `),l("disabled",{color:"var(--n-tab-text-color-disabled)"})])]),r("tabs-nav",[l("line-type",[l("top",[_("prefix, suffix",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 bottom: -1px;
 `)]),l("left",[_("prefix, suffix",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 right: -1px;
 `)]),l("right",[_("prefix, suffix",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 left: -1px;
 `)]),l("bottom",[_("prefix, suffix",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-nav-scroll-content",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-bar",`
 top: -1px;
 `)]),_("prefix, suffix",`
 transition: border-color .3s var(--n-bezier);
 `),r("tabs-nav-scroll-content",`
 transition: border-color .3s var(--n-bezier);
 `),r("tabs-bar",`
 border-radius: 0;
 `)]),l("card-type",[_("prefix, suffix",`
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
 `,[l("addable",`
 padding-left: 8px;
 padding-right: 8px;
 font-size: 16px;
 justify-content: center;
 `,[_("height-placeholder",`
 width: 0;
 font-size: var(--n-tab-font-size);
 `),Pt("disabled",[$("&:hover",`
 color: var(--n-tab-text-color-hover);
 `)])]),l("closable","padding-right: 8px;"),l("active",`
 background-color: #0000;
 font-weight: var(--n-tab-font-weight-active);
 color: var(--n-tab-text-color-active);
 `),l("disabled","color: var(--n-tab-text-color-disabled);")])]),l("left, right",`
 flex-direction: column; 
 `,[_("prefix, suffix",`
 padding: var(--n-tab-padding-vertical);
 `),r("tabs-wrapper",`
 flex-direction: column;
 `),r("tabs-tab-wrapper",`
 flex-direction: column;
 `,[r("tabs-tab-pad",`
 height: var(--n-tab-gap-vertical);
 width: 100%;
 `)])]),l("top",[l("card-type",[r("tabs-scroll-padding","border-bottom: 1px solid var(--n-tab-border-color);"),_("prefix, suffix",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-top-left-radius: var(--n-tab-border-radius);
 border-top-right-radius: var(--n-tab-border-radius);
 `,[l("active",`
 border-bottom: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-bottom: 1px solid var(--n-tab-border-color);
 `)])]),l("left",[l("card-type",[r("tabs-scroll-padding","border-right: 1px solid var(--n-tab-border-color);"),_("prefix, suffix",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-top-left-radius: var(--n-tab-border-radius);
 border-bottom-left-radius: var(--n-tab-border-radius);
 `,[l("active",`
 border-right: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-right: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-right: 1px solid var(--n-tab-border-color);
 `)])]),l("right",[l("card-type",[r("tabs-scroll-padding","border-left: 1px solid var(--n-tab-border-color);"),_("prefix, suffix",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-top-right-radius: var(--n-tab-border-radius);
 border-bottom-right-radius: var(--n-tab-border-radius);
 `,[l("active",`
 border-left: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-left: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-left: 1px solid var(--n-tab-border-color);
 `)])]),l("bottom",[l("card-type",[r("tabs-scroll-padding","border-top: 1px solid var(--n-tab-border-color);"),_("prefix, suffix",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-tab",`
 border-bottom-left-radius: var(--n-tab-border-radius);
 border-bottom-right-radius: var(--n-tab-border-radius);
 `,[l("active",`
 border-top: 1px solid #0000;
 `)]),r("tabs-tab-pad",`
 border-top: 1px solid var(--n-tab-border-color);
 `),r("tabs-pad",`
 border-top: 1px solid var(--n-tab-border-color);
 `)])])])]),be=Kt,aa=Object.assign(Object.assign({},ne.props),{value:[String,Number],defaultValue:[String,Number],trigger:{type:String,default:"click"},type:{type:String,default:"bar"},closable:Boolean,justifyContent:String,size:{type:String,default:"medium"},placement:{type:String,default:"top"},tabStyle:[String,Object],tabClass:String,addTabStyle:[String,Object],addTabClass:String,barWidth:Number,paneClass:String,paneStyle:[String,Object],paneWrapperClass:String,paneWrapperStyle:[String,Object],addable:[Boolean,Object],tabsPadding:{type:Number,default:0},animated:Boolean,onBeforeLeave:Function,onAdd:Function,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onClose:[Function,Array],labelSize:String,activeName:[String,Number],onActiveNameChange:[Function,Array]}),sa=J({name:"Tabs",props:aa,slots:Object,setup(e,{slots:t}){var i,u,s,g;const{mergedClsPrefixRef:m,inlineThemeDisabled:h}=Pe(e),R=ne("Tabs","-tabs",ta,_t,e,m),x=E(null),C=E(null),W=E(null),z=E(null),d=E(null),y=E(null),p=E(!0),w=E(!0),S=Se(e,["labelSize","size"]),T=Se(e,["activeName","value"]),B=E((u=(i=T.value)!==null&&i!==void 0?i:e.defaultValue)!==null&&u!==void 0?u:t.default?(g=(s=se(t.default())[0])===null||s===void 0?void 0:s.props)===null||g===void 0?void 0:g.name:null),L=Wt(T,B),v={id:0},f=I(()=>{if(!(!e.justifyContent||e.type==="card"))return{display:"flex",justifyContent:e.justifyContent}});G(L,()=>{v.id=0,D(),K()});function P(){var a;const{value:n}=L;return n===null?null:(a=x.value)===null||a===void 0?void 0:a.querySelector(`[data-name="${n}"]`)}function O(a){if(e.type==="card")return;const{value:n}=C;if(!n)return;const o=n.style.opacity==="0";if(a){const c=`${m.value}-tabs-bar--disabled`,{barWidth:j,placement:A}=e;if(a.dataset.disabled==="true"?n.classList.add(c):n.classList.remove(c),["top","bottom"].includes(A)){if(Q(["top","maxHeight","height"]),typeof j=="number"&&a.offsetWidth>=j){const H=Math.floor((a.offsetWidth-j)/2)+a.offsetLeft;n.style.left=`${H}px`,n.style.maxWidth=`${j}px`}else n.style.left=`${a.offsetLeft}px`,n.style.maxWidth=`${a.offsetWidth}px`;n.style.width="8192px",o&&(n.style.transition="none"),n.offsetWidth,o&&(n.style.transition="",n.style.opacity="1")}else{if(Q(["left","maxWidth","width"]),typeof j=="number"&&a.offsetHeight>=j){const H=Math.floor((a.offsetHeight-j)/2)+a.offsetTop;n.style.top=`${H}px`,n.style.maxHeight=`${j}px`}else n.style.top=`${a.offsetTop}px`,n.style.maxHeight=`${a.offsetHeight}px`;n.style.height="8192px",o&&(n.style.transition="none"),n.offsetHeight,o&&(n.style.transition="",n.style.opacity="1")}}}function M(){if(e.type==="card")return;const{value:a}=C;a&&(a.style.opacity="0")}function Q(a){const{value:n}=C;if(n)for(const o of a)n.style[o]=""}function D(){if(e.type==="card")return;const a=P();a?O(a):M()}function K(){var a;const n=(a=d.value)===null||a===void 0?void 0:a.$el;if(!n)return;const o=P();if(!o)return;const{scrollLeft:c,offsetWidth:j}=n,{offsetLeft:A,offsetWidth:H}=o;c>A?n.scrollTo({top:0,left:A,behavior:"smooth"}):A+H>c+j&&n.scrollTo({top:0,left:A+H-j,behavior:"smooth"})}const Z=E(null);let re=0,F=null;function Ee(a){const n=Z.value;if(n){re=a.getBoundingClientRect().height;const o=`${re}px`,c=()=>{n.style.height=o,n.style.maxHeight=o};F?(c(),F(),F=null):F=c}}function Be(a){const n=Z.value;if(n){const o=a.getBoundingClientRect().height,c=()=>{document.body.offsetHeight,n.style.maxHeight=`${o}px`,n.style.height=`${Math.max(re,o)}px`};F?(F(),F=null,c()):F=c}}function ke(){const a=Z.value;if(a){a.style.maxHeight="",a.style.height="";const{paneWrapperStyle:n}=e;if(typeof n=="string")a.style.cssText=n;else if(n){const{maxHeight:o,height:c}=n;o!==void 0&&(a.style.maxHeight=o),c!==void 0&&(a.style.height=c)}}}const ve={value:[]},ge=E("next");function Ae(a){const n=L.value;let o="next";for(const c of ve.value){if(c===n)break;if(c===a){o="prev";break}}ge.value=o,He(a)}function He(a){const{onActiveNameChange:n,onUpdateValue:o,"onUpdate:value":c}=e;n&&ae(n,a),o&&ae(o,a),c&&ae(c,a),B.value=a}function Ne(a){const{onClose:n}=e;n&&ae(n,a)}function me(){const{value:a}=C;if(!a)return;const n="transition-disabled";a.classList.add(n),D(),a.classList.remove(n)}const V=E(null);function oe({transitionDisabled:a}){const n=x.value;if(!n)return;a&&n.classList.add("transition-disabled");const o=P();o&&V.value&&(V.value.style.width=`${o.offsetWidth}px`,V.value.style.height=`${o.offsetHeight}px`,V.value.style.transform=`translateX(${o.offsetLeft-kt(getComputedStyle(n).paddingLeft)}px)`,a&&V.value.offsetWidth),a&&n.classList.remove("transition-disabled")}G([L],()=>{e.type==="segment"&&de(()=>{oe({transitionDisabled:!1})})}),_e(()=>{e.type==="segment"&&oe({transitionDisabled:!0})});let xe=0;function Oe(a){var n;if(a.contentRect.width===0&&a.contentRect.height===0||xe===a.contentRect.width)return;xe=a.contentRect.width;const{type:o}=e;if((o==="line"||o==="bar")&&me(),o!=="segment"){const{placement:c}=e;ie((c==="top"||c==="bottom"?(n=d.value)===null||n===void 0?void 0:n.$el:y.value)||null)}}const Ie=be(Oe,64);G([()=>e.justifyContent,()=>e.size],()=>{de(()=>{const{type:a}=e;(a==="line"||a==="bar")&&me()})});const X=E(!1);function Fe(a){var n;const{target:o,contentRect:{width:c,height:j}}=a,A=o.parentElement.parentElement.offsetWidth,H=o.parentElement.parentElement.offsetHeight,{placement:q}=e;if(!X.value)q==="top"||q==="bottom"?A<c&&(X.value=!0):H<j&&(X.value=!0);else{const{value:Y}=z;if(!Y)return;q==="top"||q==="bottom"?A-c>Y.$el.offsetWidth&&(X.value=!1):H-j>Y.$el.offsetHeight&&(X.value=!1)}ie(((n=d.value)===null||n===void 0?void 0:n.$el)||null)}const Me=be(Fe,64);function De(){const{onAdd:a}=e;a&&a(),de(()=>{const n=P(),{value:o}=d;!n||!o||o.scrollTo({left:n.offsetLeft,top:0,behavior:"smooth"})})}function ie(a){if(!a)return;const{placement:n}=e;if(n==="top"||n==="bottom"){const{scrollLeft:o,scrollWidth:c,offsetWidth:j}=a;p.value=o<=0,w.value=o+j>=c}else{const{scrollTop:o,scrollHeight:c,offsetHeight:j}=a;p.value=o<=0,w.value=o+j>=c}}const Ve=be(a=>{ie(a.target)},64);Lt(he,{triggerRef:k(e,"trigger"),tabStyleRef:k(e,"tabStyle"),tabClassRef:k(e,"tabClass"),addTabStyleRef:k(e,"addTabStyle"),addTabClassRef:k(e,"addTabClass"),paneClassRef:k(e,"paneClass"),paneStyleRef:k(e,"paneStyle"),mergedClsPrefixRef:m,typeRef:k(e,"type"),closableRef:k(e,"closable"),valueRef:L,tabChangeIdRef:v,onBeforeLeaveRef:k(e,"onBeforeLeave"),activateTab:Ae,handleClose:Ne,handleAdd:De}),Et(()=>{D(),K()}),Bt(()=>{const{value:a}=W;if(!a)return;const{value:n}=m,o=`${n}-tabs-nav-scroll-wrapper--shadow-start`,c=`${n}-tabs-nav-scroll-wrapper--shadow-end`;p.value?a.classList.remove(o):a.classList.add(o),w.value?a.classList.remove(c):a.classList.add(c)});const Xe={syncBarPosition:()=>{D()}},Ue=()=>{oe({transitionDisabled:!0})},ye=I(()=>{const{value:a}=S,{type:n}=e,o={card:"Card",bar:"Bar",line:"Line",segment:"Segment"}[n],c=`${a}${o}`,{self:{barColor:j,closeIconColor:A,closeIconColorHover:H,closeIconColorPressed:q,tabColor:Y,tabBorderColor:qe,paneTextColor:Ge,tabFontWeight:Ke,tabBorderRadius:Ye,tabFontWeightActive:Je,colorSegment:Qe,fontWeightStrong:Ze,tabColorSegment:et,closeSize:tt,closeIconSize:at,closeColorHover:nt,closeColorPressed:rt,closeBorderRadius:ot,[N("panePadding",a)]:ee,[N("tabPadding",c)]:it,[N("tabPaddingVertical",c)]:st,[N("tabGap",c)]:lt,[N("tabGap",`${c}Vertical`)]:dt,[N("tabTextColor",n)]:ct,[N("tabTextColorActive",n)]:bt,[N("tabTextColorHover",n)]:ft,[N("tabTextColorDisabled",n)]:ut,[N("tabFontSize",a)]:pt},common:{cubicBezierEaseInOut:ht}}=R.value;return{"--n-bezier":ht,"--n-color-segment":Qe,"--n-bar-color":j,"--n-tab-font-size":pt,"--n-tab-text-color":ct,"--n-tab-text-color-active":bt,"--n-tab-text-color-disabled":ut,"--n-tab-text-color-hover":ft,"--n-pane-text-color":Ge,"--n-tab-border-color":qe,"--n-tab-border-radius":Ye,"--n-close-size":tt,"--n-close-icon-size":at,"--n-close-color-hover":nt,"--n-close-color-pressed":rt,"--n-close-border-radius":ot,"--n-close-icon-color":A,"--n-close-icon-color-hover":H,"--n-close-icon-color-pressed":q,"--n-tab-color":Y,"--n-tab-font-weight":Ke,"--n-tab-font-weight-active":Je,"--n-tab-padding":it,"--n-tab-padding-vertical":st,"--n-tab-gap":lt,"--n-tab-gap-vertical":dt,"--n-pane-padding-left":te(ee,"left"),"--n-pane-padding-right":te(ee,"right"),"--n-pane-padding-top":te(ee,"top"),"--n-pane-padding-bottom":te(ee,"bottom"),"--n-font-weight-strong":Ze,"--n-tab-color-segment":et}}),U=h?We("tabs",I(()=>`${S.value[0]}${e.type[0]}`),ye,e):void 0;return Object.assign({mergedClsPrefix:m,mergedValue:L,renderedNames:new Set,segmentCapsuleElRef:V,tabsPaneWrapperRef:Z,tabsElRef:x,barElRef:C,addTabInstRef:z,xScrollInstRef:d,scrollWrapperElRef:W,addTabFixed:X,tabWrapperStyle:f,handleNavResize:Ie,mergedSize:S,handleScroll:Ve,handleTabsResize:Me,cssVars:h?void 0:ye,themeClass:U?.themeClass,animationDirection:ge,renderNameListRef:ve,yScrollElRef:y,handleSegmentResize:Ue,onAnimationBeforeLeave:Ee,onAnimationEnter:Be,onAnimationAfterEnter:ke,onRender:U?.onRender},Xe)},render(){const{mergedClsPrefix:e,type:t,placement:i,addTabFixed:u,addable:s,mergedSize:g,renderNameListRef:m,onRender:h,paneWrapperClass:R,paneWrapperStyle:x,$slots:{default:C,prefix:W,suffix:z}}=this;h?.();const d=C?se(C()).filter(v=>v.type.__TAB_PANE__===!0):[],y=C?se(C()).filter(v=>v.type.__TAB__===!0):[],p=!y.length,w=t==="card",S=t==="segment",T=!w&&!S&&this.justifyContent;m.value=[];const B=()=>{const v=b("div",{style:this.tabWrapperStyle,class:`${e}-tabs-wrapper`},T?null:b("div",{class:`${e}-tabs-scroll-padding`,style:i==="top"||i==="bottom"?{width:`${this.tabsPadding}px`}:{height:`${this.tabsPadding}px`}}),p?d.map((f,P)=>(m.value.push(f.props.name),fe(b(ue,Object.assign({},f.props,{internalCreatedByPane:!0,internalLeftPadded:P!==0&&(!T||T==="center"||T==="start"||T==="end")}),f.children?{default:f.children.tab}:void 0)))):y.map((f,P)=>(m.value.push(f.props.name),fe(P!==0&&!T?Te(f):f))),!u&&s&&w?ze(s,(p?d.length:y.length)!==0):null,T?null:b("div",{class:`${e}-tabs-scroll-padding`,style:{width:`${this.tabsPadding}px`}}));return b("div",{ref:"tabsElRef",class:`${e}-tabs-nav-scroll-content`},w&&s?b(le,{onResize:this.handleTabsResize},{default:()=>v}):v,w?b("div",{class:`${e}-tabs-pad`}):null,w?null:b("div",{ref:"barElRef",class:`${e}-tabs-bar`}))},L=S?"top":i;return b("div",{class:[`${e}-tabs`,this.themeClass,`${e}-tabs--${t}-type`,`${e}-tabs--${g}-size`,T&&`${e}-tabs--flex`,`${e}-tabs--${L}`],style:this.cssVars},b("div",{class:[`${e}-tabs-nav--${t}-type`,`${e}-tabs-nav--${L}`,`${e}-tabs-nav`]},Ce(W,v=>v&&b("div",{class:`${e}-tabs-nav__prefix`},v)),S?b(le,{onResize:this.handleSegmentResize},{default:()=>b("div",{class:`${e}-tabs-rail`,ref:"tabsElRef"},b("div",{class:`${e}-tabs-capsule`,ref:"segmentCapsuleElRef"},b("div",{class:`${e}-tabs-wrapper`},b("div",{class:`${e}-tabs-tab`}))),p?d.map((v,f)=>(m.value.push(v.props.name),b(ue,Object.assign({},v.props,{internalCreatedByPane:!0,internalLeftPadded:f!==0}),v.children?{default:v.children.tab}:void 0))):y.map((v,f)=>(m.value.push(v.props.name),f===0?v:Te(v))))}):b(le,{onResize:this.handleNavResize},{default:()=>b("div",{class:`${e}-tabs-nav-scroll-wrapper`,ref:"scrollWrapperElRef"},["top","bottom"].includes(L)?b(Mt,{ref:"xScrollInstRef",onScroll:this.handleScroll},{default:B}):b("div",{class:`${e}-tabs-nav-y-scroll`,onScroll:this.handleScroll,ref:"yScrollElRef"},B()))}),u&&s&&w?ze(s,!0):null,Ce(z,v=>v&&b("div",{class:`${e}-tabs-nav__suffix`},v))),p&&(this.animated&&(L==="top"||L==="bottom")?b("div",{ref:"tabsPaneWrapperRef",style:x,class:[`${e}-tabs-pane-wrapper`,R]},Re(d,this.mergedValue,this.renderedNames,this.onAnimationBeforeLeave,this.onAnimationEnter,this.onAnimationAfterEnter,this.animationDirection)):Re(d,this.mergedValue,this.renderedNames)))}});function Re(e,t,i,u,s,g,m){const h=[];return e.forEach(R=>{const{name:x,displayDirective:C,"display-directive":W}=R.props,z=y=>C===y||W===y,d=t===x;if(R.key!==void 0&&(R.key=x),d||z("show")||z("show:lazy")&&i.has(x)){i.has(x)||i.add(x);const y=!z("if");h.push(y?At(R,[[Ht,d]]):R)}}),m?b(Nt,{name:`${m}-transition`,onBeforeLeave:u,onEnter:s,onAfterEnter:g},{default:()=>h}):h}function ze(e,t){return b(ue,{ref:"addTabInstRef",key:"__addable",name:"__addable",internalCreatedByPane:!0,internalAddable:!0,internalLeftPadded:t,disabled:typeof e=="object"&&e.disabled})}function Te(e){const t=Ot(e);return t.props?t.props.internalLeftPadded=!0:t.props={internalLeftPadded:!0},t}function fe(e){return Array.isArray(e.dynamicProps)?e.dynamicProps.includes("internalLeftPadded")||e.dynamicProps.push("internalLeftPadded"):e.dynamicProps=["internalLeftPadded"],e}export{sa as N,ia as a,oa as b};
