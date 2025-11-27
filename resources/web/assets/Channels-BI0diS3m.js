import{f as le,h as p,a as m,z,d as ie,e as I,a1 as Ie,a2 as Ua,u as ge,j as M,l as N,a3 as Oe,m as ne,a4 as Aa,a5 as ia,p as pe,c as Ba,a6 as Va,a7 as ee,a8 as Fa,a9 as _a,aa as Ea,ab as La,ac as Ne,ad as We,ae as sa,af as Oa,ag as ja,ah as Ha,ai as Ka,k as qa,aj as Ga,ak as Xe,Q as Ee,al as Wa,am as Xa,an as Ya,ao as Qa,ap as Ja,aq as Za,ar as da,as as be,Y as me,X as Z,at as _,au as et,av as ua,I as De,aw as at,ax as tt,i as lt,b as nt,ay as Ye,az as rt,aA as ot,aB as it,r as st,aC as dt,aD as Le,T as ut,v as Qe,t as ct,aE as vt,aF as Re,aG as Se,aH as ft,o as ht,C as mt,D as Me,E as se,F as je,_ as pt,G as gt,s as bt,U as Fe,K as d,L as l,H as fe,J as n,M as yt,a0 as Q,aI as Je,aJ as xt,aK as j,aL as oe,aM as _e,R as Ze,$ as wt}from"./index-o4Nj2Cvq.js";import{s as Ct,N as kt,a as zt,b as ea}from"./DataTable-jiwH-0KG.js";import{A as Rt}from"./Add-CYnKA-89.js";import{N as Te}from"./Switch-DEzSjWiZ.js";import{N as he}from"./InputNumber-xgBbxMG9.js";import{N as St}from"./Popconfirm-ByTMrvTC.js";import{N as aa}from"./Select-D4Iz-QNo.js";const Tt=le({name:"ChevronLeft",render(){return p("svg",{viewBox:"0 0 16 16",fill:"none",xmlns:"http://www.w3.org/2000/svg"},p("path",{d:"M10.3536 3.14645C10.5488 3.34171 10.5488 3.65829 10.3536 3.85355L6.20711 8L10.3536 12.1464C10.5488 12.3417 10.5488 12.6583 10.3536 12.8536C10.1583 13.0488 9.84171 13.0488 9.64645 12.8536L5.14645 8.35355C4.95118 8.15829 4.95118 7.84171 5.14645 7.64645L9.64645 3.14645C9.84171 2.95118 10.1583 2.95118 10.3536 3.14645Z",fill:"currentColor"}))}}),Pt=m("collapse","width: 100%;",[m("collapse-item",`
 font-size: var(--n-font-size);
 color: var(--n-text-color);
 transition:
 color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 margin: var(--n-item-margin);
 `,[z("disabled",[I("header","cursor: not-allowed;",[I("header-main",`
 color: var(--n-title-text-color-disabled);
 `),m("collapse-item-arrow",`
 color: var(--n-arrow-color-disabled);
 `)])]),m("collapse-item","margin-left: 32px;"),ie("&:first-child","margin-top: 0;"),ie("&:first-child >",[I("header","padding-top: 0;")]),z("left-arrow-placement",[I("header",[m("collapse-item-arrow","margin-right: 4px;")])]),z("right-arrow-placement",[I("header",[m("collapse-item-arrow","margin-left: 4px;")])]),I("content-wrapper",[I("content-inner","padding-top: 16px;"),Ua({duration:"0.15s"})]),z("active",[I("header",[z("active",[m("collapse-item-arrow","transform: rotate(90deg);")])])]),ie("&:not(:first-child)","border-top: 1px solid var(--n-divider-color);"),Ie("disabled",[z("trigger-area-main",[I("header",[I("header-main","cursor: pointer;"),m("collapse-item-arrow","cursor: default;")])]),z("trigger-area-arrow",[I("header",[m("collapse-item-arrow","cursor: pointer;")])]),z("trigger-area-extra",[I("header",[I("header-extra","cursor: pointer;")])])]),I("header",`
 font-size: var(--n-title-font-size);
 display: flex;
 flex-wrap: nowrap;
 align-items: center;
 transition: color .3s var(--n-bezier);
 position: relative;
 padding: var(--n-title-padding);
 color: var(--n-title-text-color);
 `,[I("header-main",`
 display: flex;
 flex-wrap: nowrap;
 align-items: center;
 font-weight: var(--n-title-font-weight);
 transition: color .3s var(--n-bezier);
 flex: 1;
 color: var(--n-title-text-color);
 `),I("header-extra",`
 display: flex;
 align-items: center;
 transition: color .3s var(--n-bezier);
 color: var(--n-text-color);
 `),m("collapse-item-arrow",`
 display: flex;
 transition:
 transform .15s var(--n-bezier),
 color .3s var(--n-bezier);
 font-size: 18px;
 color: var(--n-arrow-color);
 `)])])]),$t=Object.assign(Object.assign({},ne.props),{defaultExpandedNames:{type:[Array,String],default:null},expandedNames:[Array,String],arrowPlacement:{type:String,default:"left"},accordion:{type:Boolean,default:!1},displayDirective:{type:String,default:"if"},triggerAreas:{type:Array,default:()=>["main","extra","arrow"]},onItemHeaderClick:[Function,Array],"onUpdate:expandedNames":[Function,Array],onUpdateExpandedNames:[Function,Array],onExpandedNamesChange:{type:[Function,Array],validator:()=>!0,default:void 0}}),ca=Ba("n-collapse"),ta=le({name:"Collapse",props:$t,slots:Object,setup(e,{slots:i}){const{mergedClsPrefixRef:g,inlineThemeDisabled:f,mergedRtlRef:h}=ge(e),s=M(e.defaultExpandedNames),b=N(()=>e.expandedNames),R=Oe(b,s),$=ne("Collapse","-collapse",Pt,Aa,e,g);function y(A){const{"onUpdate:expandedNames":S,onUpdateExpandedNames:T,onExpandedNamesChange:q}=e;T&&ee(T,A),S&&ee(S,A),q&&ee(q,A),s.value=A}function U(A){const{onItemHeaderClick:S}=e;S&&ee(S,A)}function x(A,S,T){const{accordion:q}=e,{value:J}=R;if(q)A?(y([S]),U({name:S,expanded:!0,event:T})):(y([]),U({name:S,expanded:!1,event:T}));else if(!Array.isArray(J))y([S]),U({name:S,expanded:!0,event:T});else{const E=J.slice(),B=E.findIndex(Y=>S===Y);~B?(E.splice(B,1),y(E),U({name:S,expanded:!1,event:T})):(E.push(S),y(E),U({name:S,expanded:!0,event:T}))}}Va(ca,{props:e,mergedClsPrefixRef:g,expandedNamesRef:R,slots:i,toggleItem:x});const o=ia("Collapse",h,g),L=N(()=>{const{common:{cubicBezierEaseInOut:A},self:{titleFontWeight:S,dividerColor:T,titlePadding:q,titleTextColor:J,titleTextColorDisabled:E,textColor:B,arrowColor:Y,fontSize:H,titleFontSize:F,arrowColorDisabled:P,itemMargin:V}}=$.value;return{"--n-font-size":H,"--n-bezier":A,"--n-text-color":B,"--n-divider-color":T,"--n-title-padding":q,"--n-title-font-size":F,"--n-title-text-color":J,"--n-title-text-color-disabled":E,"--n-title-font-weight":S,"--n-arrow-color":Y,"--n-arrow-color-disabled":P,"--n-item-margin":V}}),O=f?pe("collapse",void 0,L,e):void 0;return{rtlEnabled:o,mergedTheme:$,mergedClsPrefix:g,cssVars:f?void 0:L,themeClass:O?.themeClass,onRender:O?.onRender}},render(){var e;return(e=this.onRender)===null||e===void 0||e.call(this),p("div",{class:[`${this.mergedClsPrefix}-collapse`,this.rtlEnabled&&`${this.mergedClsPrefix}-collapse--rtl`,this.themeClass],style:this.cssVars},this.$slots)}}),It=le({name:"CollapseItemContent",props:{displayDirective:{type:String,required:!0},show:Boolean,clsPrefix:{type:String,required:!0}},setup(e){return{onceTrue:La(Ne(e,"show"))}},render(){return p(Fa,null,{default:()=>{const{show:e,displayDirective:i,onceTrue:g,clsPrefix:f}=this,h=i==="show"&&g,s=p("div",{class:`${f}-collapse-item__content-wrapper`},p("div",{class:`${f}-collapse-item__content-inner`},this.$slots));return h?_a(s,[[Ea,e]]):e?s:null}})}}),Dt={title:String,name:[String,Number],disabled:Boolean,displayDirective:String},Pe=le({name:"CollapseItem",props:Dt,setup(e){const{mergedRtlRef:i}=ge(e),g=Ha(),f=Ka(()=>{var x;return(x=e.name)!==null&&x!==void 0?x:g}),h=qa(ca);h||Ga("collapse-item","`n-collapse-item` must be placed inside `n-collapse`.");const{expandedNamesRef:s,props:b,mergedClsPrefixRef:R,slots:$}=h,y=N(()=>{const{value:x}=s;if(Array.isArray(x)){const{value:o}=f;return!~x.findIndex(L=>L===o)}else if(x){const{value:o}=f;return o!==x}return!0});return{rtlEnabled:ia("Collapse",i,R),collapseSlots:$,randomName:g,mergedClsPrefix:R,collapsed:y,triggerAreas:Ne(b,"triggerAreas"),mergedDisplayDirective:N(()=>{const{displayDirective:x}=e;return x||b.displayDirective}),arrowPlacement:N(()=>b.arrowPlacement),handleClick(x){let o="main";Xe(x,"arrow")&&(o="arrow"),Xe(x,"extra")&&(o="extra"),b.triggerAreas.includes(o)&&h&&!e.disabled&&h.toggleItem(y.value,f.value,x)}}},render(){const{collapseSlots:e,$slots:i,arrowPlacement:g,collapsed:f,mergedDisplayDirective:h,mergedClsPrefix:s,disabled:b,triggerAreas:R}=this,$=We(i.header,{collapsed:f},()=>[this.title]),y=i["header-extra"]||e["header-extra"],U=i.arrow||e.arrow;return p("div",{class:[`${s}-collapse-item`,`${s}-collapse-item--${g}-arrow-placement`,b&&`${s}-collapse-item--disabled`,!f&&`${s}-collapse-item--active`,R.map(x=>`${s}-collapse-item--trigger-area-${x}`)]},p("div",{class:[`${s}-collapse-item__header`,!f&&`${s}-collapse-item__header--active`]},p("div",{class:`${s}-collapse-item__header-main`,onClick:this.handleClick},g==="right"&&$,p("div",{class:`${s}-collapse-item-arrow`,key:this.rtlEnabled?0:1,"data-arrow":!0},We(U,{collapsed:f},()=>[p(sa,{clsPrefix:s},{default:()=>this.rtlEnabled?p(Tt,null):p(Oa,null)})])),g==="left"&&$),ja(y,{collapsed:f},x=>p("div",{class:`${s}-collapse-item__header-extra`,onClick:this.handleClick,"data-extra":!0},x))),p(It,{clsPrefix:s,displayDirective:h,show:!f},i))}}),Mt=m("divider",`
 position: relative;
 display: flex;
 width: 100%;
 box-sizing: border-box;
 font-size: 16px;
 color: var(--n-text-color);
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
`,[Ie("vertical",`
 margin-top: 24px;
 margin-bottom: 24px;
 `,[Ie("no-title",`
 display: flex;
 align-items: center;
 `)]),I("title",`
 display: flex;
 align-items: center;
 margin-left: 12px;
 margin-right: 12px;
 white-space: nowrap;
 font-weight: var(--n-font-weight);
 `),z("title-position-left",[I("line",[z("left",{width:"28px"})])]),z("title-position-right",[I("line",[z("right",{width:"28px"})])]),z("dashed",[I("line",`
 background-color: #0000;
 height: 0px;
 width: 100%;
 border-style: dashed;
 border-width: 1px 0 0;
 `)]),z("vertical",`
 display: inline-block;
 height: 1em;
 margin: 0 8px;
 vertical-align: middle;
 width: 1px;
 `),I("line",`
 border: none;
 transition: background-color .3s var(--n-bezier), border-color .3s var(--n-bezier);
 height: 1px;
 width: 100%;
 margin: 0;
 `),Ie("dashed",[I("line",{backgroundColor:"var(--n-color)"})]),z("dashed",[I("line",{borderColor:"var(--n-color)"})]),z("vertical",{backgroundColor:"var(--n-color)"})]),Nt=Object.assign(Object.assign({},ne.props),{titlePlacement:{type:String,default:"center"},dashed:Boolean,vertical:Boolean}),Ut=le({name:"Divider",props:Nt,setup(e){const{mergedClsPrefixRef:i,inlineThemeDisabled:g}=ge(e),f=ne("Divider","-divider",Mt,Wa,e,i),h=N(()=>{const{common:{cubicBezierEaseInOut:b},self:{color:R,textColor:$,fontWeight:y}}=f.value;return{"--n-bezier":b,"--n-color":R,"--n-text-color":$,"--n-font-weight":y}}),s=g?pe("divider",void 0,h,e):void 0;return{mergedClsPrefix:i,cssVars:g?void 0:h,themeClass:s?.themeClass,onRender:s?.onRender}},render(){var e;const{$slots:i,titlePlacement:g,vertical:f,dashed:h,cssVars:s,mergedClsPrefix:b}=this;return(e=this.onRender)===null||e===void 0||e.call(this),p("div",{role:"separator",class:[`${b}-divider`,this.themeClass,{[`${b}-divider--vertical`]:f,[`${b}-divider--no-title`]:!i.default,[`${b}-divider--dashed`]:h,[`${b}-divider--title-position-${g}`]:i.default&&g}],style:s},f?null:p("div",{class:`${b}-divider__line ${b}-divider__line--left`}),!f&&i.default?p(Ee,null,p("div",{class:`${b}-divider__title`},this.$slots),p("div",{class:`${b}-divider__line ${b}-divider__line--right`})):null)}}),At=Xa({name:"DynamicTags",common:da,peers:{Input:Za,Button:Ja,Tag:Qa,Space:Ya},self(){return{inputWidth:"64px"}}}),Bt=m("dynamic-tags",[m("input",{minWidth:"var(--n-input-width)"})]),Vt=Object.assign(Object.assign(Object.assign({},ne.props),at),{size:{type:String,default:"medium"},closable:{type:Boolean,default:!0},defaultValue:{type:Array,default:()=>[]},value:Array,inputClass:String,inputStyle:[String,Object],inputProps:Object,max:Number,tagClass:String,tagStyle:[String,Object],renderTag:Function,onCreate:{type:Function,default:e=>e},"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onChange:[Function,Array]}),Ft=le({name:"DynamicTags",props:Vt,slots:Object,setup(e){const{mergedClsPrefixRef:i,inlineThemeDisabled:g}=ge(e),{localeRef:f}=et("DynamicTags"),h=ua(e),{mergedDisabledRef:s}=h,b=M(""),R=M(!1),$=M(!0),y=M(null),U=ne("DynamicTags","-dynamic-tags",Bt,At,e,i),x=M(e.defaultValue),o=Ne(e,"value"),L=Oe(o,x),O=N(()=>f.value.add),A=N(()=>Ct(e.size)),S=N(()=>s.value||!!e.max&&L.value.length>=e.max);function T(P){const{onChange:V,"onUpdate:value":G,onUpdateValue:ae}=e,{nTriggerFormInput:de,nTriggerFormChange:ue}=h;V&&ee(V,P),ae&&ee(ae,P),G&&ee(G,P),x.value=P,de(),ue()}function q(P){const V=L.value.slice(0);V.splice(P,1),T(V)}function J(P){switch(P.key){case"Enter":E()}}function E(P){const V=P??b.value;if(V){const G=L.value.slice(0);G.push(e.onCreate(V)),T(G)}R.value=!1,$.value=!0,b.value=""}function B(){E()}function Y(){R.value=!0,De(()=>{var P;(P=y.value)===null||P===void 0||P.focus(),$.value=!1})}const H=N(()=>{const{self:{inputWidth:P}}=U.value;return{"--n-input-width":P}}),F=g?pe("dynamic-tags",void 0,H,e):void 0;return{mergedClsPrefix:i,inputInstRef:y,localizedAdd:O,inputSize:A,inputValue:b,showInput:R,inputForceFocused:$,mergedValue:L,mergedDisabled:s,triggerDisabled:S,handleInputKeyDown:J,handleAddClick:Y,handleInputBlur:B,handleCloseClick:q,handleInputConfirm:E,mergedTheme:U,cssVars:g?void 0:H,themeClass:F?.themeClass,onRender:F?.onRender}},render(){const{mergedTheme:e,cssVars:i,mergedClsPrefix:g,onRender:f,renderTag:h}=this;return f?.(),p(_,{class:[`${g}-dynamic-tags`,this.themeClass],size:"small",style:i,theme:e.peers.Space,themeOverrides:e.peerOverrides.Space,itemStyle:"display: flex;"},{default:()=>{const{mergedTheme:s,tagClass:b,tagStyle:R,type:$,round:y,size:U,color:x,closable:o,mergedDisabled:L,showInput:O,inputValue:A,inputClass:S,inputStyle:T,inputSize:q,inputForceFocused:J,triggerDisabled:E,handleInputKeyDown:B,handleInputBlur:Y,handleAddClick:H,handleCloseClick:F,handleInputConfirm:P,$slots:V}=this;return this.mergedValue.map((G,ae)=>h?h(G,ae):p(be,{key:ae,theme:s.peers.Tag,themeOverrides:s.peerOverrides.Tag,class:b,style:R,type:$,round:y,size:U,color:x,closable:o,disabled:L,onClose:()=>{F(ae)}},{default:()=>typeof G=="string"?G:G.label})).concat(O?V.input?V.input({submit:P,deactivate:Y}):p(me,Object.assign({placeholder:"",size:q,style:T,class:S,autosize:!0},this.inputProps,{ref:"inputInstRef",value:A,onUpdateValue:G=>{this.inputValue=G},theme:s.peers.Input,themeOverrides:s.peerOverrides.Input,onKeydown:B,onBlur:Y,internalForceFocus:J})):V.trigger?V.trigger({activate:H,disabled:E}):p(Z,{dashed:!0,disabled:E,theme:s.peers.Button,themeOverrides:s.peerOverrides.Button,size:q,onClick:H},{icon:()=>p(sa,{clsPrefix:g},{default:()=>p(Rt,null)})}))}})}});function _t(e){const i="rgba(0, 0, 0, .85)",g="0 2px 8px 0 rgba(0, 0, 0, 0.12)",{railColor:f,primaryColor:h,baseColor:s,cardColor:b,modalColor:R,popoverColor:$,borderRadius:y,fontSize:U,opacityDisabled:x}=e;return Object.assign(Object.assign({},tt),{fontSize:U,markFontSize:U,railColor:f,railColorHover:f,fillColor:h,fillColorHover:h,opacityDisabled:x,handleColor:"#FFF",dotColor:b,dotColorModal:R,dotColorPopover:$,handleBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowHover:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowActive:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",handleBoxShadowFocus:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",indicatorColor:i,indicatorBoxShadow:g,indicatorTextColor:s,indicatorBorderRadius:y,dotBorder:`2px solid ${f}`,dotBorderActive:`2px solid ${h}`,dotBoxShadow:""})}const Et={common:da,self:_t},Lt=ie([m("slider",`
 display: block;
 padding: calc((var(--n-handle-size) - var(--n-rail-height)) / 2) 0;
 position: relative;
 z-index: 0;
 width: 100%;
 cursor: pointer;
 user-select: none;
 -webkit-user-select: none;
 `,[z("reverse",[m("slider-handles",[m("slider-handle-wrapper",`
 transform: translate(50%, -50%);
 `)]),m("slider-dots",[m("slider-dot",`
 transform: translateX(50%, -50%);
 `)]),z("vertical",[m("slider-handles",[m("slider-handle-wrapper",`
 transform: translate(-50%, -50%);
 `)]),m("slider-marks",[m("slider-mark",`
 transform: translateY(calc(-50% + var(--n-dot-height) / 2));
 `)]),m("slider-dots",[m("slider-dot",`
 transform: translateX(-50%) translateY(0);
 `)])])]),z("vertical",`
 box-sizing: content-box;
 padding: 0 calc((var(--n-handle-size) - var(--n-rail-height)) / 2);
 width: var(--n-rail-width-vertical);
 height: 100%;
 `,[m("slider-handles",`
 top: calc(var(--n-handle-size) / 2);
 right: 0;
 bottom: calc(var(--n-handle-size) / 2);
 left: 0;
 `,[m("slider-handle-wrapper",`
 top: unset;
 left: 50%;
 transform: translate(-50%, 50%);
 `)]),m("slider-rail",`
 height: 100%;
 `,[I("fill",`
 top: unset;
 right: 0;
 bottom: unset;
 left: 0;
 `)]),z("with-mark",`
 width: var(--n-rail-width-vertical);
 margin: 0 32px 0 8px;
 `),m("slider-marks",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 22px;
 font-size: var(--n-mark-font-size);
 `,[m("slider-mark",`
 transform: translateY(50%);
 white-space: nowrap;
 `)]),m("slider-dots",`
 top: calc(var(--n-handle-size) / 2);
 right: unset;
 bottom: calc(var(--n-handle-size) / 2);
 left: 50%;
 `,[m("slider-dot",`
 transform: translateX(-50%) translateY(50%);
 `)])]),z("disabled",`
 cursor: not-allowed;
 opacity: var(--n-opacity-disabled);
 `,[m("slider-handle",`
 cursor: not-allowed;
 `)]),z("with-mark",`
 width: 100%;
 margin: 8px 0 32px 0;
 `),ie("&:hover",[m("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[I("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),m("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),z("active",[m("slider-rail",{backgroundColor:"var(--n-rail-color-hover)"},[I("fill",{backgroundColor:"var(--n-fill-color-hover)"})]),m("slider-handle",{boxShadow:"var(--n-handle-box-shadow-hover)"})]),m("slider-marks",`
 position: absolute;
 top: 18px;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[m("slider-mark",`
 position: absolute;
 transform: translateX(-50%);
 white-space: nowrap;
 `)]),m("slider-rail",`
 width: 100%;
 position: relative;
 height: var(--n-rail-height);
 background-color: var(--n-rail-color);
 transition: background-color .3s var(--n-bezier);
 border-radius: calc(var(--n-rail-height) / 2);
 `,[I("fill",`
 position: absolute;
 top: 0;
 bottom: 0;
 border-radius: calc(var(--n-rail-height) / 2);
 transition: background-color .3s var(--n-bezier);
 background-color: var(--n-fill-color);
 `)]),m("slider-handles",`
 position: absolute;
 top: 0;
 right: calc(var(--n-handle-size) / 2);
 bottom: 0;
 left: calc(var(--n-handle-size) / 2);
 `,[m("slider-handle-wrapper",`
 outline: none;
 position: absolute;
 top: 50%;
 transform: translate(-50%, -50%);
 cursor: pointer;
 display: flex;
 `,[m("slider-handle",`
 height: var(--n-handle-size);
 width: var(--n-handle-size);
 border-radius: 50%;
 overflow: hidden;
 transition: box-shadow .2s var(--n-bezier), background-color .3s var(--n-bezier);
 background-color: var(--n-handle-color);
 box-shadow: var(--n-handle-box-shadow);
 `,[ie("&:hover",`
 box-shadow: var(--n-handle-box-shadow-hover);
 `)]),ie("&:focus",[m("slider-handle",`
 box-shadow: var(--n-handle-box-shadow-focus);
 `,[ie("&:hover",`
 box-shadow: var(--n-handle-box-shadow-active);
 `)])])])]),m("slider-dots",`
 position: absolute;
 top: 50%;
 left: calc(var(--n-handle-size) / 2);
 right: calc(var(--n-handle-size) / 2);
 `,[z("transition-disabled",[m("slider-dot","transition: none;")]),m("slider-dot",`
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
 `,[z("active","border: var(--n-dot-border-active);")])])]),m("slider-handle-indicator",`
 font-size: var(--n-font-size);
 padding: 6px 10px;
 border-radius: var(--n-indicator-border-radius);
 color: var(--n-indicator-text-color);
 background-color: var(--n-indicator-color);
 box-shadow: var(--n-indicator-box-shadow);
 `,[Ye()]),m("slider-handle-indicator",`
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
 `),Ye()]),lt(m("slider",[m("slider-dot","background-color: var(--n-dot-color-modal);")])),nt(m("slider",[m("slider-dot","background-color: var(--n-dot-color-popover);")]))]);function la(e){return window.TouchEvent&&e instanceof window.TouchEvent}function na(){const e=new Map,i=g=>f=>{e.set(g,f)};return rt(()=>{e.clear()}),[e,i]}const Ot=0,jt=Object.assign(Object.assign({},ne.props),{to:Le.propTo,defaultValue:{type:[Number,Array],default:0},marks:Object,disabled:{type:Boolean,default:void 0},formatTooltip:Function,keyboard:{type:Boolean,default:!0},min:{type:Number,default:0},max:{type:Number,default:100},step:{type:[Number,String],default:1},range:Boolean,value:[Number,Array],placement:String,showTooltip:{type:Boolean,default:void 0},tooltip:{type:Boolean,default:!0},vertical:Boolean,reverse:Boolean,"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],onDragstart:[Function],onDragend:[Function]}),$e=le({name:"Slider",props:jt,slots:Object,setup(e){const{mergedClsPrefixRef:i,namespaceRef:g,inlineThemeDisabled:f}=ge(e),h=ne("Slider","-slider",Lt,Et,e,i),s=M(null),[b,R]=na(),[$,y]=na(),U=M(new Set),x=ua(e),{mergedDisabledRef:o}=x,L=N(()=>{const{step:t}=e;if(Number(t)<=0||t==="mark")return 0;const r=t.toString();let v=0;return r.includes(".")&&(v=r.length-r.indexOf(".")-1),v}),O=M(e.defaultValue),A=Ne(e,"value"),S=Oe(A,O),T=N(()=>{const{value:t}=S;return(e.range?t:[t]).map(He)}),q=N(()=>T.value.length>2),J=N(()=>e.placement===void 0?e.vertical?"right":"top":e.placement),E=N(()=>{const{marks:t}=e;return t?Object.keys(t).map(Number.parseFloat):null}),B=M(-1),Y=M(-1),H=M(-1),F=M(!1),P=M(!1),V=N(()=>{const{vertical:t,reverse:r}=e;return t?r?"top":"bottom":r?"right":"left"}),G=N(()=>{if(q.value)return;const t=T.value,r=ye(e.range?Math.min(...t):e.min),v=ye(e.range?Math.max(...t):t[0]),{value:w}=V;return e.vertical?{[w]:`${r}%`,height:`${v-r}%`}:{[w]:`${r}%`,width:`${v-r}%`}}),ae=N(()=>{const t=[],{marks:r}=e;if(r){const v=T.value.slice();v.sort((X,W)=>X-W);const{value:w}=V,{value:D}=q,{range:K}=e,te=D?()=>!1:X=>K?X>=v[0]&&X<=v[v.length-1]:X<=v[0];for(const X of Object.keys(r)){const W=Number(X);t.push({active:te(W),key:W,label:r[X],style:{[w]:`${ye(W)}%`}})}}return t});function de(t,r){const v=ye(t),{value:w}=V;return{[w]:`${v}%`,zIndex:r===B.value?1:0}}function ue(t){return e.showTooltip||H.value===t||B.value===t&&F.value}function Ue(t){return F.value?!(B.value===t&&Y.value===t):!0}function u(t){var r;~t&&(B.value=t,(r=b.get(t))===null||r===void 0||r.focus())}function a(){$.forEach((t,r)=>{ue(r)&&t.syncPosition()})}function c(t){const{"onUpdate:value":r,onUpdateValue:v}=e,{nTriggerFormInput:w,nTriggerFormChange:D}=x;v&&ee(v,t),r&&ee(r,t),O.value=t,w(),D()}function C(t){const{range:r}=e;if(r){if(Array.isArray(t)){const{value:v}=T;t.join()!==v.join()&&c(t)}}else Array.isArray(t)||T.value[0]!==t&&c(t)}function k(t,r){if(e.range){const v=T.value.slice();v.splice(r,1,t),C(v)}else C(t)}function Ae(t,r,v){const w=v!==void 0;v||(v=t-r>0?1:-1);const D=E.value||[],{step:K}=e;if(K==="mark"){const W=xe(t,D.concat(r),w?v:void 0);return W?W.value:r}if(K<=0)return r;const{value:te}=L;let X;if(w){const W=Number((r/K).toFixed(te)),re=Math.floor(W),Be=W>re?re:re-1,Ve=W<re?re:re+1;X=xe(r,[Number((Be*K).toFixed(te)),Number((Ve*K).toFixed(te)),...D],v)}else{const W=fa(t);X=xe(t,[...D,W])}return X?He(X.value):r}function He(t){return Math.min(e.max,Math.max(e.min,t))}function ye(t){const{max:r,min:v}=e;return(t-v)/(r-v)*100}function va(t){const{max:r,min:v}=e;return v+(r-v)*t}function fa(t){const{step:r,min:v}=e;if(Number(r)<=0||r==="mark")return t;const w=Math.round((t-v)/r)*r+v;return Number(w.toFixed(L.value))}function xe(t,r=E.value,v){if(!r?.length)return null;let w=null,D=-1;for(;++D<r.length;){const K=r[D]-t,te=Math.abs(K);(v===void 0||K*v>0)&&(w===null||te<w.distance)&&(w={index:D,distance:te,value:r[D]})}return w}function Ke(t){const r=s.value;if(!r)return;const v=la(t)?t.touches[0]:t,w=r.getBoundingClientRect();let D;return e.vertical?D=(w.bottom-v.clientY)/w.height:D=(v.clientX-w.left)/w.width,e.reverse&&(D=1-D),va(D)}function ha(t){if(o.value||!e.keyboard)return;const{vertical:r,reverse:v}=e;switch(t.key){case"ArrowUp":t.preventDefault(),we(r&&v?-1:1);break;case"ArrowRight":t.preventDefault(),we(!r&&v?-1:1);break;case"ArrowDown":t.preventDefault(),we(r&&v?1:-1);break;case"ArrowLeft":t.preventDefault(),we(!r&&v?1:-1);break}}function we(t){const r=B.value;if(r===-1)return;const{step:v}=e,w=T.value[r],D=Number(v)<=0||v==="mark"?w:w+v*t;k(Ae(D,w,t>0?1:-1),r)}function ma(t){var r,v;if(o.value||!la(t)&&t.button!==Ot)return;const w=Ke(t);if(w===void 0)return;const D=T.value.slice(),K=e.range?(v=(r=xe(w,D))===null||r===void 0?void 0:r.index)!==null&&v!==void 0?v:-1:0;K!==-1&&(t.preventDefault(),u(K),pa(),k(Ae(w,T.value[K]),K))}function pa(){F.value||(F.value=!0,e.onDragstart&&ee(e.onDragstart),Re("touchend",document,ze),Re("mouseup",document,ze),Re("touchmove",document,ke),Re("mousemove",document,ke))}function Ce(){F.value&&(F.value=!1,e.onDragend&&ee(e.onDragend),Se("touchend",document,ze),Se("mouseup",document,ze),Se("touchmove",document,ke),Se("mousemove",document,ke))}function ke(t){const{value:r}=B;if(!F.value||r===-1){Ce();return}const v=Ke(t);v!==void 0&&k(Ae(v,T.value[r]),r)}function ze(){Ce()}function ga(t){B.value=t,o.value||(H.value=t)}function ba(t){B.value===t&&(B.value=-1,Ce()),H.value===t&&(H.value=-1)}function ya(t){H.value=t}function xa(t){H.value===t&&(H.value=-1)}Qe(B,(t,r)=>void De(()=>Y.value=r)),Qe(S,()=>{if(e.marks){if(P.value)return;P.value=!0,De(()=>{P.value=!1})}De(a)}),ct(()=>{Ce()});const qe=N(()=>{const{self:{markFontSize:t,railColor:r,railColorHover:v,fillColor:w,fillColorHover:D,handleColor:K,opacityDisabled:te,dotColor:X,dotColorModal:W,handleBoxShadow:re,handleBoxShadowHover:Be,handleBoxShadowActive:Ve,handleBoxShadowFocus:wa,dotBorder:Ca,dotBoxShadow:ka,railHeight:za,railWidthVertical:Ra,handleSize:Sa,dotHeight:Ta,dotWidth:Pa,dotBorderRadius:$a,fontSize:Ia,dotBorderActive:Da,dotColorPopover:Ma},common:{cubicBezierEaseInOut:Na}}=h.value;return{"--n-bezier":Na,"--n-dot-border":Ca,"--n-dot-border-active":Da,"--n-dot-border-radius":$a,"--n-dot-box-shadow":ka,"--n-dot-color":X,"--n-dot-color-modal":W,"--n-dot-color-popover":Ma,"--n-dot-height":Ta,"--n-dot-width":Pa,"--n-fill-color":w,"--n-fill-color-hover":D,"--n-font-size":Ia,"--n-handle-box-shadow":re,"--n-handle-box-shadow-active":Ve,"--n-handle-box-shadow-focus":wa,"--n-handle-box-shadow-hover":Be,"--n-handle-color":K,"--n-handle-size":Sa,"--n-opacity-disabled":te,"--n-rail-color":r,"--n-rail-color-hover":v,"--n-rail-height":za,"--n-rail-width-vertical":Ra,"--n-mark-font-size":t}}),ce=f?pe("slider",void 0,qe,e):void 0,Ge=N(()=>{const{self:{fontSize:t,indicatorColor:r,indicatorBoxShadow:v,indicatorTextColor:w,indicatorBorderRadius:D}}=h.value;return{"--n-font-size":t,"--n-indicator-border-radius":D,"--n-indicator-box-shadow":v,"--n-indicator-color":r,"--n-indicator-text-color":w}}),ve=f?pe("slider-indicator",void 0,Ge,e):void 0;return{mergedClsPrefix:i,namespace:g,uncontrolledValue:O,mergedValue:S,mergedDisabled:o,mergedPlacement:J,isMounted:vt(),adjustedTo:Le(e),dotTransitionDisabled:P,markInfos:ae,isShowTooltip:ue,shouldKeepTooltipTransition:Ue,handleRailRef:s,setHandleRefs:R,setFollowerRefs:y,fillStyle:G,getHandleStyle:de,activeIndex:B,arrifiedValues:T,followerEnabledIndexSet:U,handleRailMouseDown:ma,handleHandleFocus:ga,handleHandleBlur:ba,handleHandleMouseEnter:ya,handleHandleMouseLeave:xa,handleRailKeyDown:ha,indicatorCssVars:f?void 0:Ge,indicatorThemeClass:ve?.themeClass,indicatorOnRender:ve?.onRender,cssVars:f?void 0:qe,themeClass:ce?.themeClass,onRender:ce?.onRender}},render(){var e;const{mergedClsPrefix:i,themeClass:g,formatTooltip:f}=this;return(e=this.onRender)===null||e===void 0||e.call(this),p("div",{class:[`${i}-slider`,g,{[`${i}-slider--disabled`]:this.mergedDisabled,[`${i}-slider--active`]:this.activeIndex!==-1,[`${i}-slider--with-mark`]:this.marks,[`${i}-slider--vertical`]:this.vertical,[`${i}-slider--reverse`]:this.reverse}],style:this.cssVars,onKeydown:this.handleRailKeyDown,onMousedown:this.handleRailMouseDown,onTouchstart:this.handleRailMouseDown},p("div",{class:`${i}-slider-rail`},p("div",{class:`${i}-slider-rail__fill`,style:this.fillStyle}),this.marks?p("div",{class:[`${i}-slider-dots`,this.dotTransitionDisabled&&`${i}-slider-dots--transition-disabled`]},this.markInfos.map(h=>p("div",{key:h.key,class:[`${i}-slider-dot`,{[`${i}-slider-dot--active`]:h.active}],style:h.style}))):null,p("div",{ref:"handleRailRef",class:`${i}-slider-handles`},this.arrifiedValues.map((h,s)=>{const b=this.isShowTooltip(s);return p(ot,null,{default:()=>[p(it,null,{default:()=>p("div",{ref:this.setHandleRefs(s),class:`${i}-slider-handle-wrapper`,tabindex:this.mergedDisabled?-1:0,role:"slider","aria-valuenow":h,"aria-valuemin":this.min,"aria-valuemax":this.max,"aria-orientation":this.vertical?"vertical":"horizontal","aria-disabled":this.disabled,style:this.getHandleStyle(h,s),onFocus:()=>{this.handleHandleFocus(s)},onBlur:()=>{this.handleHandleBlur(s)},onMouseenter:()=>{this.handleHandleMouseEnter(s)},onMouseleave:()=>{this.handleHandleMouseLeave(s)}},st(this.$slots.thumb,()=>[p("div",{class:`${i}-slider-handle`})]))}),this.tooltip&&p(dt,{ref:this.setFollowerRefs(s),show:b,to:this.adjustedTo,enabled:this.showTooltip&&!this.range||this.followerEnabledIndexSet.has(s),teleportDisabled:this.adjustedTo===Le.tdkey,placement:this.mergedPlacement,containerClass:this.namespace},{default:()=>p(ut,{name:"fade-in-scale-up-transition",appear:this.isMounted,css:this.shouldKeepTooltipTransition(s),onEnter:()=>{this.followerEnabledIndexSet.add(s)},onAfterLeave:()=>{this.followerEnabledIndexSet.delete(s)}},{default:()=>{var R;return b?((R=this.indicatorOnRender)===null||R===void 0||R.call(this),p("div",{class:[`${i}-slider-handle-indicator`,this.indicatorThemeClass,`${i}-slider-handle-indicator--${this.mergedPlacement}`],style:this.indicatorCssVars},typeof f=="function"?f(h):h)):null}})})]})})),this.marks?p("div",{class:`${i}-slider-marks`},this.markInfos.map(h=>p("div",{key:h.key,class:`${i}-slider-mark`,style:h.style},typeof h.label=="function"?h.label():h.label))):null))}}),Ht=m("text",`
 transition: color .3s var(--n-bezier);
 color: var(--n-text-color);
`,[z("strong",`
 font-weight: var(--n-font-weight-strong);
 `),z("italic",{fontStyle:"italic"}),z("underline",{textDecoration:"underline"}),z("code",`
 line-height: 1.4;
 display: inline-block;
 font-family: var(--n-font-famliy-mono);
 transition: 
 color .3s var(--n-bezier),
 border-color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 box-sizing: border-box;
 padding: .05em .35em 0 .35em;
 border-radius: var(--n-code-border-radius);
 font-size: .9em;
 color: var(--n-code-text-color);
 background-color: var(--n-code-color);
 border: var(--n-code-border);
 `)]),Kt=Object.assign(Object.assign({},ne.props),{code:Boolean,type:{type:String,default:"default"},delete:Boolean,strong:Boolean,italic:Boolean,underline:Boolean,depth:[String,Number],tag:String,as:{type:String,validator:()=>!0,default:void 0}}),ra=le({name:"Text",props:Kt,setup(e){const{mergedClsPrefixRef:i,inlineThemeDisabled:g}=ge(e),f=ne("Typography","-text",Ht,ft,e,i),h=N(()=>{const{depth:b,type:R}=e,$=R==="default"?b===void 0?"textColor":`textColor${b}Depth`:ht("textColor",R),{common:{fontWeightStrong:y,fontFamilyMono:U,cubicBezierEaseInOut:x},self:{codeTextColor:o,codeBorderRadius:L,codeColor:O,codeBorder:A,[$]:S}}=f.value;return{"--n-bezier":x,"--n-text-color":S,"--n-font-weight-strong":y,"--n-font-famliy-mono":U,"--n-code-border-radius":L,"--n-code-text-color":o,"--n-code-color":O,"--n-code-border":A}}),s=g?pe("text",N(()=>`${e.type[0]}${e.depth||""}`),h,e):void 0;return{mergedClsPrefix:i,compitableTag:mt(e,["as","tag"]),cssVars:g?void 0:h,themeClass:s?.themeClass,onRender:s?.onRender}},render(){var e,i,g;const{mergedClsPrefix:f}=this;(e=this.onRender)===null||e===void 0||e.call(this);const h=[`${f}-text`,this.themeClass,{[`${f}-text--code`]:this.code,[`${f}-text--delete`]:this.delete,[`${f}-text--strong`]:this.strong,[`${f}-text--italic`]:this.italic,[`${f}-text--underline`]:this.underline}],s=(g=(i=this.$slots).default)===null||g===void 0?void 0:g.call(i);return this.code?p("code",{class:h,style:this.cssVars},this.delete?p("del",null,s):s):this.delete?p("del",{class:h,style:this.cssVars},s):p(this.compitableTag||"span",{class:h,style:this.cssVars},s)}}),qt={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},oa=le({name:"CheckCircleOutlined",render:function(i,g){return se(),Me("svg",qt,g[0]||(g[0]=[je("path",{d:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4l8-8z",fill:"currentColor"},null,-1)]))}}),Gt={xmlns:"http://www.w3.org/2000/svg","xmlns:xlink":"http://www.w3.org/1999/xlink",viewBox:"0 0 24 24"},Wt=le({name:"SearchOutlined",render:function(i,g){return se(),Me("svg",Gt,g[0]||(g[0]=[je("path",{d:"M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5S14 7.01 14 9.5S11.99 14 9.5 14z",fill:"currentColor"},null,-1)]))}}),Xt={style:{"max-height":"50vh","overflow-y":"auto","padding-right":"4px"}},Yt={__name:"Channels",setup(e){const i=gt(),g=M([]),f=M(!1),h=M(!1);M(!1);const s=M(!1),b=M(!1),R=M(""),$=M([]),y=M([]),U=M(""),x=M(null),o=M({name:"",adapterType:"openai",baseUrl:"",apiKey:"",models:[],priority:1,enabled:!0,advanced:{streaming:{enabled:!1,chunkSize:1024},thinking:{enableReasoning:!1,defaultLevel:"medium",adaptThinking:!0,sendThinkingAsMessage:!1},llm:{temperature:.7,maxTokens:4e3,topP:1,frequencyPenalty:0,presencePenalty:0}}}),L={name:{required:!0,message:"请输入名称",trigger:"blur"},adapterType:{required:!0,message:"请选择类型",trigger:"change"},baseUrl:{required:!0,message:"请输入BaseURL",trigger:"blur"},apiKey:{required:!0,message:"请输入API Key",trigger:"blur"}},O=[{title:"名称",key:"name"},{title:"类型",key:"adapterType"},{title:"BaseURL",key:"baseUrl"},{title:"状态",key:"status",render(u){return p(be,{type:u.status==="active"?"success":u.status==="error"?"error":"default"},{default:()=>u.status||"idle"})}},{title:"优先级",key:"priority",sorter:(u,a)=>u.priority-a.priority},{title:"操作",key:"actions",render(u){return p(_,{},{default:()=>[p(Z,{size:"small",onClick:()=>J(u)},{default:()=>"测试"}),p(Z,{size:"small",onClick:()=>T(u)},{default:()=>"编辑"}),p(St,{onPositiveClick:()=>q(u)},{trigger:()=>p(Z,{size:"small",type:"error"},{default:()=>"删除"}),default:()=>"确定要删除吗？"})]})}}];async function A(){try{const u=await fe.get("/api/channels/list");u.data.code===0&&(g.value=u.data.data)}catch{i.error("获取渠道列表失败")}}function S(){b.value=!1,R.value="",o.value={name:"",adapterType:"openai",baseUrl:"",apiKey:"",models:[],priority:1,enabled:!0,advanced:{streaming:{enabled:!1,chunkSize:1024},thinking:{enableReasoning:!1,defaultLevel:"medium",adaptThinking:!0,sendThinkingAsMessage:!1},llm:{temperature:.7,maxTokens:4e3,topP:1,frequencyPenalty:0,presencePenalty:0}}},f.value=!0}function T(u){b.value=!0,R.value=u.id,o.value={...u,apiKey:u.apiKey||"",advanced:u.advanced||{streaming:{enabled:!1,chunkSize:1024},thinking:{enableReasoning:!1,defaultLevel:"medium",adaptThinking:!0,sendThinkingAsMessage:!1},llm:{temperature:.7,maxTokens:4e3,topP:1,frequencyPenalty:0,presencePenalty:0}}},f.value=!0}async function q(u){try{const a=await fe.delete(`/api/channels/${u.id}`);a.data.code===0?(i.success("删除成功"),A()):i.error(a.data.message)}catch{i.error("删除失败")}}async function J(u){try{const a=await fe.post("/api/channels/test",{adapterType:u.adapterType,baseUrl:u.baseUrl,apiKey:u.apiKey,models:u.models||[],advanced:u.advanced||{}});a.data.code===0?i.success(a.data.data.message):i.error(a.data.message)}catch(a){i.error("测试失败: "+(a.response?.data?.message||a.message))}}const E=N(()=>{const u={零一万物:[],OpenAI:[],Claude:[],Gemini:[],DeepSeek:[],"智谱 (GLM)":[],"Qwen (通义千问)":[],"Doubao (豆包)":[],"Mistral AI":[],Llama:[],Grok:[],"Kimi (Moonshot)":[],MiniMax:[],Cohere:[],其他:[]},a=U.value.toLowerCase();return $.value.filter(C=>C.toLowerCase().includes(a)).forEach(C=>{const k=C.toLowerCase();k.includes("yi-")||k.includes("零一")?u.零一万物.push(C):k.includes("gpt")||k.includes("o1")||k.includes("o3")||k.includes("davinci")?u.OpenAI.push(C):k.includes("claude")?u.Claude.push(C):k.includes("gemini")||k.includes("gemma")?u.Gemini.push(C):k.includes("deepseek")?u.DeepSeek.push(C):k.includes("glm")||k.includes("智谱")?u["智谱 (GLM)"].push(C):k.includes("qwen")||k.includes("qwq")?u["Qwen (通义千问)"].push(C):k.includes("doubao")||k.includes("豆包")?u["Doubao (豆包)"].push(C):k.includes("mistral")?u["Mistral AI"].push(C):k.includes("llama")?u.Llama.push(C):k.includes("grok")?u.Grok.push(C):k.includes("kimi")||k.includes("moonshot")?u["Kimi (Moonshot)"].push(C):k.includes("minimax")||k.includes("abab")?u.MiniMax.push(C):k.includes("cohere")||k.includes("command")?u.Cohere.push(C):u.其他.push(C)}),Object.entries(u).filter(([C,k])=>k.length>0).map(([C,k])=>({name:C,models:k}))}),B=N(()=>$.value.filter(u=>!o.value.models.includes(u)).length),Y=N(()=>o.value.models.length);async function H(){if(!o.value.baseUrl||!o.value.apiKey){i.warning("请先填写 BaseURL 和 API Key");return}s.value=!0;try{const u=await fe.post("/api/channels/fetch-models",{adapterType:o.value.adapterType,baseUrl:o.value.baseUrl,apiKey:o.value.apiKey});u.data.code===0?($.value=u.data.data.models,y.value=o.value.models||[],h.value=!0,i.success(`获取到 ${u.data.data.models.length} 个模型`)):i.error(u.data.message)}catch(u){i.error("获取模型失败: "+u.message)}finally{s.value=!1}}function F(){o.value.models=[...y.value],h.value=!1,i.success(`已选择 ${y.value.length} 个模型`)}function P(){y.value=[...$.value]}function V(){y.value=[]}function G(u){u.models.forEach(a=>{y.value.includes(a)||y.value.push(a)})}function ae(u){y.value=y.value.filter(a=>!u.models.includes(a))}function de(u){return u.models.every(a=>y.value.includes(a))}function ue(u){const a=u.models.filter(c=>y.value.includes(c)).length;return a>0&&a<u.models.length}async function Ue(){x.value?.validate(async u=>{if(!u)try{let a;b.value?a=await fe.put(`/api/channels/${R.value}`,o.value):a=await fe.post("/api/channels",o.value),a.data.code===0?(i.success("保存成功"),f.value=!1,A()):i.error(a.data.message)}catch{i.error("保存失败")}})}return bt(()=>{A()}),(u,a)=>(se(),Fe(l(_),{vertical:""},{default:d(()=>[n(l(yt),{title:"渠道管理"},{"header-extra":d(()=>[n(l(Z),{type:"primary",onClick:S},{default:d(()=>[...a[28]||(a[28]=[Q("添加渠道",-1)])]),_:1})]),default:d(()=>[n(l(kt),{columns:O,data:g.value},null,8,["data"])]),_:1}),n(l(Je),{show:f.value,"onUpdate:show":a[22]||(a[22]=c=>f.value=c),preset:"card",title:"配置渠道",style:{width:"600px"}},{footer:d(()=>[n(l(_),{justify:"end"},{default:d(()=>[n(l(Z),{onClick:a[21]||(a[21]=c=>f.value=!1)},{default:d(()=>[...a[30]||(a[30]=[Q("取消",-1)])]),_:1}),n(l(Z),{type:"primary",onClick:Ue},{default:d(()=>[...a[31]||(a[31]=[Q("保存",-1)])]),_:1})]),_:1})]),default:d(()=>[n(l(xt),{ref_key:"formRef",ref:x,model:o.value,rules:L,"label-placement":"left","label-width":"100"},{default:d(()=>[n(l(j),{label:"名称",path:"name"},{default:d(()=>[n(l(me),{value:o.value.name,"onUpdate:value":a[0]||(a[0]=c=>o.value.name=c),placeholder:"请输入名称"},null,8,["value"])]),_:1}),n(l(j),{label:"类型",path:"adapterType"},{default:d(()=>[n(l(aa),{value:o.value.adapterType,"onUpdate:value":a[1]||(a[1]=c=>o.value.adapterType=c),options:[{label:"OpenAI",value:"openai"},{label:"Gemini",value:"gemini"},{label:"Claude",value:"claude"}]},null,8,["value"])]),_:1}),n(l(j),{label:"BaseURL",path:"baseUrl"},{default:d(()=>[n(l(me),{value:o.value.baseUrl,"onUpdate:value":a[2]||(a[2]=c=>o.value.baseUrl=c),placeholder:"请输入BaseURL"},null,8,["value"])]),_:1}),n(l(j),{label:"API Key",path:"apiKey"},{default:d(()=>[n(l(me),{value:o.value.apiKey,"onUpdate:value":a[3]||(a[3]=c=>o.value.apiKey=c),type:"password","show-password-on":"click",placeholder:"请输入API Key"},null,8,["value"])]),_:1}),n(l(j),{label:"优先级",path:"priority"},{default:d(()=>[n(l(me),{value:o.value.priority,"onUpdate:value":a[4]||(a[4]=c=>o.value.priority=c),type:"number",placeholder:"数字越小优先级越高"},null,8,["value"])]),_:1}),n(l(j),{label:"模型列表",path:"models"},{default:d(()=>[n(l(_),{vertical:"",style:{width:"100%"}},{default:d(()=>[n(l(Ft),{value:o.value.models,"onUpdate:value":a[5]||(a[5]=c=>o.value.models=c)},null,8,["value"]),n(l(Z),{block:"",loading:s.value,onClick:H},{default:d(()=>[...a[29]||(a[29]=[Q("获取模型列表",-1)])]),_:1},8,["loading"])]),_:1})]),_:1}),n(l(j),{label:"高级设置"},{default:d(()=>[n(l(ta),{style:{width:"100%"}},{default:d(()=>[n(l(Pe),{title:"流式输出设置",name:"streaming"},{default:d(()=>[n(l(_),{vertical:""},{default:d(()=>[n(l(j),{label:"启用流式输出","label-placement":"left"},{default:d(()=>[n(l(Te),{value:o.value.advanced.streaming.enabled,"onUpdate:value":a[6]||(a[6]=c=>o.value.advanced.streaming.enabled=c)},null,8,["value"])]),_:1}),n(l(j),{label:"块大小","label-placement":"left"},{default:d(()=>[n(l(he),{value:o.value.advanced.streaming.chunkSize,"onUpdate:value":a[7]||(a[7]=c=>o.value.advanced.streaming.chunkSize=c),min:512,max:8192,step:512,style:{width:"100%"}},null,8,["value"])]),_:1})]),_:1})]),_:1}),n(l(Pe),{title:"思考控制设置",name:"thinking"},{default:d(()=>[n(l(_),{vertical:""},{default:d(()=>[n(l(j),{label:"启用推理模式","label-placement":"left"},{default:d(()=>[n(l(Te),{value:o.value.advanced.thinking.enableReasoning,"onUpdate:value":a[8]||(a[8]=c=>o.value.advanced.thinking.enableReasoning=c)},null,8,["value"])]),_:1}),n(l(j),{label:"默认思考级别","label-placement":"left"},{default:d(()=>[n(l(aa),{value:o.value.advanced.thinking.defaultLevel,"onUpdate:value":a[9]||(a[9]=c=>o.value.advanced.thinking.defaultLevel=c),options:[{label:"低 (Low)",value:"low"},{label:"中 (Medium)",value:"medium"},{label:"高 (High)",value:"high"}]},null,8,["value"])]),_:1}),n(l(j),{label:"自适应思考","label-placement":"left"},{default:d(()=>[n(l(Te),{value:o.value.advanced.thinking.adaptThinking,"onUpdate:value":a[10]||(a[10]=c=>o.value.advanced.thinking.adaptThinking=c)},null,8,["value"])]),_:1}),n(l(j),{label:"发送思考为消息","label-placement":"left"},{default:d(()=>[n(l(Te),{value:o.value.advanced.thinking.sendThinkingAsMessage,"onUpdate:value":a[11]||(a[11]=c=>o.value.advanced.thinking.sendThinkingAsMessage=c)},null,8,["value"])]),_:1})]),_:1})]),_:1}),n(l(Pe),{title:"LLM 参数设置",name:"llm"},{default:d(()=>[n(l(_),{vertical:""},{default:d(()=>[n(l(j),{label:"Temperature","label-placement":"left"},{default:d(()=>[n(l(_),{vertical:"",style:{width:"100%"}},{default:d(()=>[n(l($e),{value:o.value.advanced.llm.temperature,"onUpdate:value":a[12]||(a[12]=c=>o.value.advanced.llm.temperature=c),min:0,max:2,step:.1,marks:{0:"0",1:"1",2:"2"}},null,8,["value"]),n(l(he),{value:o.value.advanced.llm.temperature,"onUpdate:value":a[13]||(a[13]=c=>o.value.advanced.llm.temperature=c),min:0,max:2,step:.1,size:"small",style:{width:"100px"}},null,8,["value"])]),_:1})]),_:1}),n(l(j),{label:"Max Tokens","label-placement":"left"},{default:d(()=>[n(l(he),{value:o.value.advanced.llm.maxTokens,"onUpdate:value":a[14]||(a[14]=c=>o.value.advanced.llm.maxTokens=c),min:100,max:128e3,step:100,style:{width:"100%"}},null,8,["value"])]),_:1}),n(l(j),{label:"Top P","label-placement":"left"},{default:d(()=>[n(l(_),{vertical:"",style:{width:"100%"}},{default:d(()=>[n(l($e),{value:o.value.advanced.llm.topP,"onUpdate:value":a[15]||(a[15]=c=>o.value.advanced.llm.topP=c),min:0,max:1,step:.1,marks:{0:"0",.5:"0.5",1:"1"}},null,8,["value"]),n(l(he),{value:o.value.advanced.llm.topP,"onUpdate:value":a[16]||(a[16]=c=>o.value.advanced.llm.topP=c),min:0,max:1,step:.1,size:"small",style:{width:"100px"}},null,8,["value"])]),_:1})]),_:1}),n(l(j),{label:"Frequency Penalty","label-placement":"left"},{default:d(()=>[n(l(_),{vertical:"",style:{width:"100%"}},{default:d(()=>[n(l($e),{value:o.value.advanced.llm.frequencyPenalty,"onUpdate:value":a[17]||(a[17]=c=>o.value.advanced.llm.frequencyPenalty=c),min:-2,max:2,step:.1,marks:{"-2":"-2",0:"0",2:"2"}},null,8,["value"]),n(l(he),{value:o.value.advanced.llm.frequencyPenalty,"onUpdate:value":a[18]||(a[18]=c=>o.value.advanced.llm.frequencyPenalty=c),min:-2,max:2,step:.1,size:"small",style:{width:"100px"}},null,8,["value"])]),_:1})]),_:1}),n(l(j),{label:"Presence Penalty","label-placement":"left"},{default:d(()=>[n(l(_),{vertical:"",style:{width:"100%"}},{default:d(()=>[n(l($e),{value:o.value.advanced.llm.presencePenalty,"onUpdate:value":a[19]||(a[19]=c=>o.value.advanced.llm.presencePenalty=c),min:-2,max:2,step:.1,marks:{"-2":"-2",0:"0",2:"2"}},null,8,["value"]),n(l(he),{value:o.value.advanced.llm.presencePenalty,"onUpdate:value":a[20]||(a[20]=c=>o.value.advanced.llm.presencePenalty=c),min:-2,max:2,step:.1,size:"small",style:{width:"100px"}},null,8,["value"])]),_:1})]),_:1})]),_:1})]),_:1})]),_:1})]),_:1})]),_:1},8,["model"])]),_:1},8,["show"]),n(l(Je),{show:h.value,"onUpdate:show":a[27]||(a[27]=c=>h.value=c),preset:"card",title:"选择模型",style:{width:"800px","max-height":"85vh"},segmented:{content:"soft",footer:"soft"}},{footer:d(()=>[n(l(_),{justify:"end"},{default:d(()=>[n(l(Z),{onClick:a[26]||(a[26]=c=>h.value=!1)},{default:d(()=>[...a[34]||(a[34]=[Q("取消",-1)])]),_:1}),n(l(Z),{type:"primary",onClick:F},{default:d(()=>[Q(" 确定 ("+oe(y.value.length)+") ",1)]),_:1})]),_:1})]),default:d(()=>[n(l(_),{vertical:"",size:16},{default:d(()=>[n(l(_),{justify:"space-between",align:"center"},{default:d(()=>[n(l(_),{size:8},{default:d(()=>[n(l(be),{type:"info",bordered:!1,size:"medium"},{icon:d(()=>[n(l(_e),null,{default:d(()=>[n(l(oa))]),_:1})]),default:d(()=>[Q(" 新获取的模型 ("+oe(B.value)+") ",1)]),_:1}),n(l(be),{type:"success",bordered:!1,size:"medium"},{icon:d(()=>[n(l(_e),null,{default:d(()=>[n(l(oa))]),_:1})]),default:d(()=>[Q(" 已有的模型 ("+oe(Y.value)+") ",1)]),_:1})]),_:1})]),_:1}),n(l(me),{value:U.value,"onUpdate:value":a[23]||(a[23]=c=>U.value=c),placeholder:"搜索模型",clearable:"",size:"large"},{prefix:d(()=>[n(l(_e),null,{default:d(()=>[n(l(Wt))]),_:1})]),_:1},8,["value"]),n(l(_),{justify:"space-between",align:"center"},{default:d(()=>[n(l(ra),{depth:"3"},{default:d(()=>[Q(" 已选择 "+oe(y.value.length)+" / "+oe($.value.length),1)]),_:1}),n(l(_),{size:8},{default:d(()=>[n(l(Z),{size:"small",onClick:P},{default:d(()=>[...a[32]||(a[32]=[Q("全选",-1)])]),_:1}),n(l(Z),{size:"small",onClick:V},{default:d(()=>[...a[33]||(a[33]=[Q("取消全选",-1)])]),_:1})]),_:1})]),_:1}),n(l(Ut),{style:{margin:"0"}}),je("div",Xt,[n(l(ta),{"arrow-placement":"right"},{default:d(()=>[(se(!0),Me(Ee,null,Ze(E.value,c=>(se(),Fe(l(Pe),{key:c.name},{header:d(()=>[n(l(_),{align:"center",size:12},{default:d(()=>[n(l(ea),{checked:de(c),indeterminate:ue(c),"onUpdate:checked":C=>C?G(c):ae(c),onClick:a[24]||(a[24]=wt(()=>{},["stop"]))},null,8,["checked","indeterminate","onUpdate:checked"]),n(l(ra),{strong:""},{default:d(()=>[Q(oe(c.name),1)]),_:2},1024),n(l(be),{type:de(c)?"success":"default",size:"small",bordered:!1,round:""},{default:d(()=>[Q(oe(c.models.filter(C=>y.value.includes(C)).length)+" / "+oe(c.models.length),1)]),_:2},1032,["type"])]),_:2},1024)]),default:d(()=>[n(l(zt),{value:y.value,"onUpdate:value":a[25]||(a[25]=C=>y.value=C)},{default:d(()=>[n(l(_),{vertical:"",size:8,style:{"padding-left":"32px"}},{default:d(()=>[(se(!0),Me(Ee,null,Ze(c.models,C=>(se(),Fe(l(ea),{key:C,value:C,label:C},null,8,["value","label"]))),128))]),_:2},1024)]),_:2},1032,["value"])]),_:2},1024))),128))]),_:1})])]),_:1})]),_:1},8,["show"])]),_:1}))}},nl=pt(Yt,[["__scopeId","data-v-4466139e"]]);export{nl as default};
