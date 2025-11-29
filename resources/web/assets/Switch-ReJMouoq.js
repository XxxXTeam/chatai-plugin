import{d as L,h as a,n as de,bc as ce,bd as ue,c as H,f as t,e as N,b as l,a as I,be as U,bf as W,r as w,bg as he,bh as be,u as fe,z as E,ai as ve,w as D,x as ge,y as we,A as z,aW as m,bi as O,aY as s,C as me,I as K}from"./index-BiK0Ooh4.js";const Se=L({name:"Add",render(){return a("svg",{width:"512",height:"512",viewBox:"0 0 512 512",fill:"none",xmlns:"http://www.w3.org/2000/svg"},a("path",{d:"M256 112V400M400 256H112",stroke:"currentColor","stroke-width":"32","stroke-linecap":"round","stroke-linejoin":"round"}))}});function pe(e){const{primaryColor:d,opacityDisabled:f,borderRadius:n,textColor3:r}=e;return Object.assign(Object.assign({},ce),{iconColor:r,textColor:"white",loadingColor:d,opacityDisabled:f,railColor:"rgba(0, 0, 0, .14)",railColorActive:d,buttonBoxShadow:"0 1px 4px 0 rgba(0, 0, 0, 0.3), inset 0 0 1px 0 rgba(0, 0, 0, 0.05)",buttonColor:"#FFF",railBorderRadiusSmall:n,railBorderRadiusMedium:n,railBorderRadiusLarge:n,buttonBorderRadiusSmall:n,buttonBorderRadiusMedium:n,buttonBorderRadiusLarge:n,boxShadowFocus:`0 0 0 2px ${ue(d,{alpha:.2})}`})}const xe={common:de,self:pe},ye=H("switch",`
 height: var(--n-height);
 min-width: var(--n-width);
 vertical-align: middle;
 user-select: none;
 -webkit-user-select: none;
 display: inline-flex;
 outline: none;
 justify-content: center;
 align-items: center;
`,[t("children-placeholder",`
 height: var(--n-rail-height);
 display: flex;
 flex-direction: column;
 overflow: hidden;
 pointer-events: none;
 visibility: hidden;
 `),t("rail-placeholder",`
 display: flex;
 flex-wrap: none;
 `),t("button-placeholder",`
 width: calc(1.75 * var(--n-rail-height));
 height: var(--n-rail-height);
 `),H("base-loading",`
 position: absolute;
 top: 50%;
 left: 50%;
 transform: translateX(-50%) translateY(-50%);
 font-size: calc(var(--n-button-width) - 4px);
 color: var(--n-loading-color);
 transition: color .3s var(--n-bezier);
 `,[U({left:"50%",top:"50%",originalTransform:"translateX(-50%) translateY(-50%)"})]),t("checked, unchecked",`
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
 `),t("checked",`
 right: 0;
 padding-right: calc(1.25 * var(--n-rail-height) - var(--n-offset));
 `),t("unchecked",`
 left: 0;
 justify-content: flex-end;
 padding-left: calc(1.25 * var(--n-rail-height) - var(--n-offset));
 `),N("&:focus",[t("rail",`
 box-shadow: var(--n-box-shadow-focus);
 `)]),l("round",[t("rail","border-radius: calc(var(--n-rail-height) / 2);",[t("button","border-radius: calc(var(--n-button-height) / 2);")])]),I("disabled",[I("icon",[l("rubber-band",[l("pressed",[t("rail",[t("button","max-width: var(--n-button-width-pressed);")])]),t("rail",[N("&:active",[t("button","max-width: var(--n-button-width-pressed);")])]),l("active",[l("pressed",[t("rail",[t("button","left: calc(100% - var(--n-offset) - var(--n-button-width-pressed));")])]),t("rail",[N("&:active",[t("button","left: calc(100% - var(--n-offset) - var(--n-button-width-pressed));")])])])])])]),l("active",[t("rail",[t("button","left: calc(100% - var(--n-button-width) - var(--n-offset))")])]),t("rail",`
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
 `,[t("button-icon",`
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
 `,[U()]),t("button",`
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
 `)]),l("active",[t("rail","background-color: var(--n-rail-color-active);")]),l("loading",[t("rail",`
 cursor: wait;
 `)]),l("disabled",[t("rail",`
 cursor: not-allowed;
 opacity: .5;
 `)])]),ke=Object.assign(Object.assign({},E.props),{size:{type:String,default:"medium"},value:{type:[String,Number,Boolean],default:void 0},loading:Boolean,defaultValue:{type:[String,Number,Boolean],default:!1},disabled:{type:Boolean,default:void 0},round:{type:Boolean,default:!0},"onUpdate:value":[Function,Array],onUpdateValue:[Function,Array],checkedValue:{type:[String,Number,Boolean],default:!0},uncheckedValue:{type:[String,Number,Boolean],default:!1},railStyle:Function,rubberBand:{type:Boolean,default:!0},onChange:[Function,Array]});let B;const Be=L({name:"Switch",props:ke,slots:Object,setup(e){B===void 0&&(typeof CSS<"u"?typeof CSS.supports<"u"?B=CSS.supports("width","max(1px)"):B=!1:B=!0);const{mergedClsPrefixRef:d,inlineThemeDisabled:f}=fe(e),n=E("Switch","-switch",ye,xe,e,d),r=ve(e),{mergedSizeRef:y,mergedDisabledRef:v}=r,k=D(e.defaultValue),R=ge(e,"value"),g=we(R,k),C=z(()=>g.value===e.checkedValue),p=D(!1),i=D(!1),c=z(()=>{const{railStyle:o}=e;if(o)return o({focused:i.value,checked:C.value})});function u(o){const{"onUpdate:value":$,onChange:V,onUpdateValue:_}=e,{nTriggerFormInput:F,nTriggerFormChange:T}=r;$&&K($,o),_&&K(_,o),V&&K(V,o),k.value=o,F(),T()}function Y(){const{nTriggerFormFocus:o}=r;o()}function X(){const{nTriggerFormBlur:o}=r;o()}function q(){e.loading||v.value||(g.value!==e.checkedValue?u(e.checkedValue):u(e.uncheckedValue))}function G(){i.value=!0,Y()}function J(){i.value=!1,X(),p.value=!1}function Q(o){e.loading||v.value||o.key===" "&&(g.value!==e.checkedValue?u(e.checkedValue):u(e.uncheckedValue),p.value=!1)}function Z(o){e.loading||v.value||o.key===" "&&(o.preventDefault(),p.value=!0)}const P=z(()=>{const{value:o}=y,{self:{opacityDisabled:$,railColor:V,railColorActive:_,buttonBoxShadow:F,buttonColor:T,boxShadowFocus:ee,loadingColor:te,textColor:oe,iconColor:ie,[m("buttonHeight",o)]:h,[m("buttonWidth",o)]:ae,[m("buttonWidthPressed",o)]:ne,[m("railHeight",o)]:b,[m("railWidth",o)]:S,[m("railBorderRadius",o)]:re,[m("buttonBorderRadius",o)]:le},common:{cubicBezierEaseInOut:se}}=n.value;let j,A,M;return B?(j=`calc((${b} - ${h}) / 2)`,A=`max(${b}, ${h})`,M=`max(${S}, calc(${S} + ${h} - ${b}))`):(j=O((s(b)-s(h))/2),A=O(Math.max(s(b),s(h))),M=s(b)>s(h)?S:O(s(S)+s(h)-s(b))),{"--n-bezier":se,"--n-button-border-radius":le,"--n-button-box-shadow":F,"--n-button-color":T,"--n-button-width":ae,"--n-button-width-pressed":ne,"--n-button-height":h,"--n-height":A,"--n-offset":j,"--n-opacity-disabled":$,"--n-rail-border-radius":re,"--n-rail-color":V,"--n-rail-color-active":_,"--n-rail-height":b,"--n-rail-width":S,"--n-width":M,"--n-box-shadow-focus":ee,"--n-loading-color":te,"--n-text-color":oe,"--n-icon-color":ie}}),x=f?me("switch",z(()=>y.value[0]),P,e):void 0;return{handleClick:q,handleBlur:J,handleFocus:G,handleKeyup:Q,handleKeydown:Z,mergedRailStyle:c,pressed:p,mergedClsPrefix:d,mergedValue:g,checked:C,mergedDisabled:v,cssVars:f?void 0:P,themeClass:x?.themeClass,onRender:x?.onRender}},render(){const{mergedClsPrefix:e,mergedDisabled:d,checked:f,mergedRailStyle:n,onRender:r,$slots:y}=this;r?.();const{checked:v,unchecked:k,icon:R,"checked-icon":g,"unchecked-icon":C}=y,p=!(W(R)&&W(g)&&W(C));return a("div",{role:"switch","aria-checked":f,class:[`${e}-switch`,this.themeClass,p&&`${e}-switch--icon`,f&&`${e}-switch--active`,d&&`${e}-switch--disabled`,this.round&&`${e}-switch--round`,this.loading&&`${e}-switch--loading`,this.pressed&&`${e}-switch--pressed`,this.rubberBand&&`${e}-switch--rubber-band`],tabindex:this.mergedDisabled?void 0:0,style:this.cssVars,onClick:this.handleClick,onFocus:this.handleFocus,onBlur:this.handleBlur,onKeyup:this.handleKeyup,onKeydown:this.handleKeydown},a("div",{class:`${e}-switch__rail`,"aria-hidden":"true",style:n},w(v,i=>w(k,c=>i||c?a("div",{"aria-hidden":!0,class:`${e}-switch__children-placeholder`},a("div",{class:`${e}-switch__rail-placeholder`},a("div",{class:`${e}-switch__button-placeholder`}),i),a("div",{class:`${e}-switch__rail-placeholder`},a("div",{class:`${e}-switch__button-placeholder`}),c)):null)),a("div",{class:`${e}-switch__button`},w(R,i=>w(g,c=>w(C,u=>a(he,null,{default:()=>this.loading?a(be,{key:"loading",clsPrefix:e,strokeWidth:20}):this.checked&&(c||i)?a("div",{class:`${e}-switch__button-icon`,key:c?"checked-icon":"icon"},c||i):!this.checked&&(u||i)?a("div",{class:`${e}-switch__button-icon`,key:u?"unchecked-icon":"icon"},u||i):null})))),w(v,i=>i&&a("div",{key:"checked",class:`${e}-switch__checked`},i)),w(k,i=>i&&a("div",{key:"unchecked",class:`${e}-switch__unchecked`},i)))))}});export{Se as A,Be as N};
