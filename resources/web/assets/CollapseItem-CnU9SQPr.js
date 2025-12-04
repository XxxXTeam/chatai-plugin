import{d as S,h as s,c as f,b as x,e as $,f as o,a as M,aj as q,u as _,x as O,C as N,z as V,A as T,ak as W,i as k,D as K,q as Z,p as G,I as P,al as J,ag as Q,am as X,y as F,an as Y,w as A,ao as ee,H as ae,ap as re,s as te,aq as le,ar as D,v as oe,as as se}from"./index-BlGFC_7o.js";const ne=S({name:"ChevronLeft",render(){return s("svg",{viewBox:"0 0 16 16",fill:"none",xmlns:"http://www.w3.org/2000/svg"},s("path",{d:"M10.3536 3.14645C10.5488 3.34171 10.5488 3.65829 10.3536 3.85355L6.20711 8L10.3536 12.1464C10.5488 12.3417 10.5488 12.6583 10.3536 12.8536C10.1583 13.0488 9.84171 13.0488 9.64645 12.8536L5.14645 8.35355C4.95118 8.15829 4.95118 7.84171 5.14645 7.64645L9.64645 3.14645C9.84171 2.95118 10.1583 2.95118 10.3536 3.14645Z",fill:"currentColor"}))}}),ie=f("collapse","width: 100%;",[f("collapse-item",`
 font-size: var(--n-font-size);
 color: var(--n-text-color);
 transition:
 color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 margin: var(--n-item-margin);
 `,[x("disabled",[o("header","cursor: not-allowed;",[o("header-main",`
 color: var(--n-title-text-color-disabled);
 `),f("collapse-item-arrow",`
 color: var(--n-arrow-color-disabled);
 `)])]),f("collapse-item","margin-left: 32px;"),$("&:first-child","margin-top: 0;"),$("&:first-child >",[o("header","padding-top: 0;")]),x("left-arrow-placement",[o("header",[f("collapse-item-arrow","margin-right: 4px;")])]),x("right-arrow-placement",[o("header",[f("collapse-item-arrow","margin-left: 4px;")])]),o("content-wrapper",[o("content-inner","padding-top: 16px;"),q({duration:"0.15s"})]),x("active",[o("header",[x("active",[f("collapse-item-arrow","transform: rotate(90deg);")])])]),$("&:not(:first-child)","border-top: 1px solid var(--n-divider-color);"),M("disabled",[x("trigger-area-main",[o("header",[o("header-main","cursor: pointer;"),f("collapse-item-arrow","cursor: default;")])]),x("trigger-area-arrow",[o("header",[f("collapse-item-arrow","cursor: pointer;")])]),x("trigger-area-extra",[o("header",[o("header-extra","cursor: pointer;")])])]),o("header",`
 font-size: var(--n-title-font-size);
 display: flex;
 flex-wrap: nowrap;
 align-items: center;
 transition: color .3s var(--n-bezier);
 position: relative;
 padding: var(--n-title-padding);
 color: var(--n-title-text-color);
 `,[o("header-main",`
 display: flex;
 flex-wrap: nowrap;
 align-items: center;
 font-weight: var(--n-title-font-weight);
 transition: color .3s var(--n-bezier);
 flex: 1;
 color: var(--n-title-text-color);
 `),o("header-extra",`
 display: flex;
 align-items: center;
 transition: color .3s var(--n-bezier);
 color: var(--n-text-color);
 `),f("collapse-item-arrow",`
 display: flex;
 transition:
 transform .15s var(--n-bezier),
 color .3s var(--n-bezier);
 font-size: 18px;
 color: var(--n-arrow-color);
 `)])])]),de=Object.assign(Object.assign({},T.props),{defaultExpandedNames:{type:[Array,String],default:null},expandedNames:[Array,String],arrowPlacement:{type:String,default:"left"},accordion:{type:Boolean,default:!1},displayDirective:{type:String,default:"if"},triggerAreas:{type:Array,default:()=>["main","extra","arrow"]},onItemHeaderClick:[Function,Array],"onUpdate:expandedNames":[Function,Array],onUpdateExpandedNames:[Function,Array],onExpandedNamesChange:{type:[Function,Array],validator:()=>!0,default:void 0}}),j=Z("n-collapse"),fe=S({name:"Collapse",props:de,slots:Object,setup(e,{slots:i}){const{mergedClsPrefixRef:n,inlineThemeDisabled:l,mergedRtlRef:d}=_(e),r=O(e.defaultExpandedNames),h=N(()=>e.expandedNames),v=V(h,r),w=T("Collapse","-collapse",ie,W,e,n);function c(p){const{"onUpdate:expandedNames":t,onUpdateExpandedNames:m,onExpandedNamesChange:b}=e;m&&P(m,p),t&&P(t,p),b&&P(b,p),r.value=p}function g(p){const{onItemHeaderClick:t}=e;t&&P(t,p)}function a(p,t,m){const{accordion:b}=e,{value:E}=v;if(b)p?(c([t]),g({name:t,expanded:!0,event:m})):(c([]),g({name:t,expanded:!1,event:m}));else if(!Array.isArray(E))c([t]),g({name:t,expanded:!0,event:m});else{const C=E.slice(),I=C.findIndex(z=>t===z);~I?(C.splice(I,1),c(C),g({name:t,expanded:!1,event:m})):(C.push(t),c(C),g({name:t,expanded:!0,event:m}))}}G(j,{props:e,mergedClsPrefixRef:n,expandedNamesRef:v,slots:i,toggleItem:a});const u=k("Collapse",d,n),R=N(()=>{const{common:{cubicBezierEaseInOut:p},self:{titleFontWeight:t,dividerColor:m,titlePadding:b,titleTextColor:E,titleTextColorDisabled:C,textColor:I,arrowColor:z,fontSize:B,titleFontSize:L,arrowColorDisabled:U,itemMargin:H}}=w.value;return{"--n-font-size":B,"--n-bezier":p,"--n-text-color":I,"--n-divider-color":m,"--n-title-padding":b,"--n-title-font-size":L,"--n-title-text-color":E,"--n-title-text-color-disabled":C,"--n-title-font-weight":t,"--n-arrow-color":z,"--n-arrow-color-disabled":U,"--n-item-margin":H}}),y=l?K("collapse",void 0,R,e):void 0;return{rtlEnabled:u,mergedTheme:w,mergedClsPrefix:n,cssVars:l?void 0:R,themeClass:y?.themeClass,onRender:y?.onRender}},render(){var e;return(e=this.onRender)===null||e===void 0||e.call(this),s("div",{class:[`${this.mergedClsPrefix}-collapse`,this.rtlEnabled&&`${this.mergedClsPrefix}-collapse--rtl`,this.themeClass],style:this.cssVars},this.$slots)}}),ce=S({name:"CollapseItemContent",props:{displayDirective:{type:String,required:!0},show:Boolean,clsPrefix:{type:String,required:!0}},setup(e){return{onceTrue:X(F(e,"show"))}},render(){return s(J,null,{default:()=>{const{show:e,displayDirective:i,onceTrue:n,clsPrefix:l}=this,d=i==="show"&&n,r=s("div",{class:`${l}-collapse-item__content-wrapper`},s("div",{class:`${l}-collapse-item__content-inner`},this.$slots));return d?Q(r,[[Y,e]]):e?r:null}})}}),pe={title:String,name:[String,Number],disabled:Boolean,displayDirective:String},ue=S({name:"CollapseItem",props:pe,setup(e){const{mergedRtlRef:i}=_(e),n=ae(),l=re(()=>{var a;return(a=e.name)!==null&&a!==void 0?a:n}),d=te(j);d||le("collapse-item","`n-collapse-item` must be placed inside `n-collapse`.");const{expandedNamesRef:r,props:h,mergedClsPrefixRef:v,slots:w}=d,c=N(()=>{const{value:a}=r;if(Array.isArray(a)){const{value:u}=l;return!~a.findIndex(R=>R===u)}else if(a){const{value:u}=l;return u!==a}return!0});return{rtlEnabled:k("Collapse",i,v),collapseSlots:w,randomName:n,mergedClsPrefix:v,collapsed:c,triggerAreas:F(h,"triggerAreas"),mergedDisplayDirective:N(()=>{const{displayDirective:a}=e;return a||h.displayDirective}),arrowPlacement:N(()=>h.arrowPlacement),handleClick(a){let u="main";D(a,"arrow")&&(u="arrow"),D(a,"extra")&&(u="extra"),h.triggerAreas.includes(u)&&d&&!e.disabled&&d.toggleItem(c.value,l.value,a)}}},render(){const{collapseSlots:e,$slots:i,arrowPlacement:n,collapsed:l,mergedDisplayDirective:d,mergedClsPrefix:r,disabled:h,triggerAreas:v}=this,w=A(i.header,{collapsed:l},()=>[this.title]),c=i["header-extra"]||e["header-extra"],g=i.arrow||e.arrow;return s("div",{class:[`${r}-collapse-item`,`${r}-collapse-item--${n}-arrow-placement`,h&&`${r}-collapse-item--disabled`,!l&&`${r}-collapse-item--active`,v.map(a=>`${r}-collapse-item--trigger-area-${a}`)]},s("div",{class:[`${r}-collapse-item__header`,!l&&`${r}-collapse-item__header--active`]},s("div",{class:`${r}-collapse-item__header-main`,onClick:this.handleClick},n==="right"&&w,s("div",{class:`${r}-collapse-item-arrow`,key:this.rtlEnabled?0:1,"data-arrow":!0},A(g,{collapsed:l},()=>[s(oe,{clsPrefix:r},{default:()=>this.rtlEnabled?s(ne,null):s(se,null)})])),n==="left"&&w),ee(c,{collapsed:l},a=>s("div",{class:`${r}-collapse-item__header-extra`,onClick:this.handleClick,"data-extra":!0},a))),s(ce,{clsPrefix:r,displayDirective:d,show:!l},i))}});export{fe as N,ue as a};
