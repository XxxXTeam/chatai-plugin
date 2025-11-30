import{c as f,a as u,f as a,b as s,d as b,h as d,a3 as B,u as x,z as h,b5 as P,A as m,C as p,b6 as T,aZ as k,aW as V}from"./index-EOE_IJ3N.js";const D=f("divider",`
 position: relative;
 display: flex;
 width: 100%;
 box-sizing: border-box;
 font-size: 16px;
 color: var(--n-text-color);
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
`,[u("vertical",`
 margin-top: 24px;
 margin-bottom: 24px;
 `,[u("no-title",`
 display: flex;
 align-items: center;
 `)]),a("title",`
 display: flex;
 align-items: center;
 margin-left: 12px;
 margin-right: 12px;
 white-space: nowrap;
 font-weight: var(--n-font-weight);
 `),s("title-position-left",[a("line",[s("left",{width:"28px"})])]),s("title-position-right",[a("line",[s("right",{width:"28px"})])]),s("dashed",[a("line",`
 background-color: #0000;
 height: 0px;
 width: 100%;
 border-style: dashed;
 border-width: 1px 0 0;
 `)]),s("vertical",`
 display: inline-block;
 height: 1em;
 margin: 0 8px;
 vertical-align: middle;
 width: 1px;
 `),a("line",`
 border: none;
 transition: background-color .3s var(--n-bezier), border-color .3s var(--n-bezier);
 height: 1px;
 width: 100%;
 margin: 0;
 `),u("dashed",[a("line",{backgroundColor:"var(--n-color)"})]),s("dashed",[a("line",{borderColor:"var(--n-color)"})]),s("vertical",{backgroundColor:"var(--n-color)"})]),S=Object.assign(Object.assign({},h.props),{titlePlacement:{type:String,default:"center"},dashed:Boolean,vertical:Boolean}),E=b({name:"Divider",props:S,setup(t){const{mergedClsPrefixRef:r,inlineThemeDisabled:n}=x(t),i=h("Divider","-divider",D,P,t,r),l=m(()=>{const{common:{cubicBezierEaseInOut:o},self:{color:c,textColor:v,fontWeight:g}}=i.value;return{"--n-bezier":o,"--n-color":c,"--n-text-color":v,"--n-font-weight":g}}),e=n?p("divider",void 0,l,t):void 0;return{mergedClsPrefix:r,cssVars:n?void 0:l,themeClass:e?.themeClass,onRender:e?.onRender}},render(){var t;const{$slots:r,titlePlacement:n,vertical:i,dashed:l,cssVars:e,mergedClsPrefix:o}=this;return(t=this.onRender)===null||t===void 0||t.call(this),d("div",{role:"separator",class:[`${o}-divider`,this.themeClass,{[`${o}-divider--vertical`]:i,[`${o}-divider--no-title`]:!r.default,[`${o}-divider--dashed`]:l,[`${o}-divider--title-position-${n}`]:r.default&&n}],style:e},i?null:d("div",{class:`${o}-divider__line ${o}-divider__line--left`}),!i&&r.default?d(B,null,d("div",{class:`${o}-divider__title`},this.$slots),d("div",{class:`${o}-divider__line ${o}-divider__line--right`})):null)}}),O=f("text",`
 transition: color .3s var(--n-bezier);
 color: var(--n-text-color);
`,[s("strong",`
 font-weight: var(--n-font-weight-strong);
 `),s("italic",{fontStyle:"italic"}),s("underline",{textDecoration:"underline"}),s("code",`
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
 `)]),N=Object.assign(Object.assign({},h.props),{code:Boolean,type:{type:String,default:"default"},delete:Boolean,strong:Boolean,italic:Boolean,underline:Boolean,depth:[String,Number],tag:String,as:{type:String,validator:()=>!0,default:void 0}}),M=b({name:"Text",props:N,setup(t){const{mergedClsPrefixRef:r,inlineThemeDisabled:n}=x(t),i=h("Typography","-text",O,T,t,r),l=m(()=>{const{depth:o,type:c}=t,v=c==="default"?o===void 0?"textColor":`textColor${o}Depth`:k("textColor",c),{common:{fontWeightStrong:g,fontFamilyMono:C,cubicBezierEaseInOut:y},self:{codeTextColor:$,codeBorderRadius:z,codeColor:w,codeBorder:_,[v]:R}}=i.value;return{"--n-bezier":y,"--n-text-color":R,"--n-font-weight-strong":g,"--n-font-famliy-mono":C,"--n-code-border-radius":z,"--n-code-text-color":$,"--n-code-color":w,"--n-code-border":_}}),e=n?p("text",m(()=>`${t.type[0]}${t.depth||""}`),l,t):void 0;return{mergedClsPrefix:r,compitableTag:V(t,["as","tag"]),cssVars:n?void 0:l,themeClass:e?.themeClass,onRender:e?.onRender}},render(){var t,r,n;const{mergedClsPrefix:i}=this;(t=this.onRender)===null||t===void 0||t.call(this);const l=[`${i}-text`,this.themeClass,{[`${i}-text--code`]:this.code,[`${i}-text--delete`]:this.delete,[`${i}-text--strong`]:this.strong,[`${i}-text--italic`]:this.italic,[`${i}-text--underline`]:this.underline}],e=(n=(r=this.$slots).default)===null||n===void 0?void 0:n.call(r);return this.code?d("code",{class:l,style:this.cssVars},this.delete?d("del",null,e):e):this.delete?d("del",{class:l,style:this.cssVars},e):d(this.compitableTag||"span",{class:l,style:this.cssVars},e)}});export{E as N,M as a};
