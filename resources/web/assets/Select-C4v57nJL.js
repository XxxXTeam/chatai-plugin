import{r as C,l as B,C as we,p as nt,d as fe,D as rt,h as u,aT as ut,aO as nn,aI as on,aJ as Ye,aK as ln,X as Ke,bL as rn,bB as an,x as Y,aY as ot,bh as _e,bJ as sn,bM as Je,au as ye,av as xt,aP as Te,bN as at,G as dn,as as St,c as P,f as V,b as oe,e as se,a as lt,am as Ct,I as ct,bg as un,bD as cn,R as fn,u as st,i as Rt,n as Fe,bO as hn,bP as vn,aD as me,aX as $e,q as dt,aB as gn,F as Ee,az as Tt,bQ as bn,bR as pn,bS as mn,ab as Qe,bT as ft,ae as wn,bk as yn,bU as xn,aW as Sn,ao as Cn,ap as Rn,aq as Tn,ar as it,w as Fn,y as On,bV as ht,bW as Mn,m as vt,aE as In,bt as kn,S as zn,at as Pn,aw as Bn,bX as _n,bY as $n,t as ae}from"./index-BO19D5Ve.js";function gt(e){return e&-e}class Ft{constructor(n,o){this.l=n,this.min=o;const l=new Array(n+1);for(let i=0;i<n+1;++i)l[i]=0;this.ft=l}add(n,o){if(o===0)return;const{l,ft:i}=this;for(n+=1;n<=l;)i[n]+=o,n+=gt(n)}get(n){return this.sum(n+1)-this.sum(n)}sum(n){if(n===void 0&&(n=this.l),n<=0)return 0;const{ft:o,min:l,l:i}=this;if(n>i)throw new Error("[FinweckTree.sum]: `i` is larger than length.");let f=n*l;for(;n>0;)f+=o[n],n-=gt(n);return f}getBound(n){let o=0,l=this.l;for(;l>o;){const i=Math.floor((o+l)/2),f=this.sum(i);if(f>n){l=i;continue}else if(f<n){if(o===i)return this.sum(o+1)<=n?o+1:i;o=i}else return i}return o}}let je;function En(){return typeof document>"u"?!1:(je===void 0&&("matchMedia"in window?je=window.matchMedia("(pointer:coarse)").matches:je=!1),je)}let Ze;function bt(){return typeof document>"u"?1:(Ze===void 0&&(Ze="chrome"in window?window.devicePixelRatio:1),Ze)}const Ot="VVirtualListXScroll";function Nn({columnsRef:e,renderColRef:n,renderItemWithColsRef:o}){const l=C(0),i=C(0),f=B(()=>{const m=e.value;if(m.length===0)return null;const w=new Ft(m.length,0);return m.forEach((_,R)=>{w.add(R,_.width)}),w}),v=we(()=>{const m=f.value;return m!==null?Math.max(m.getBound(i.value)-1,0):0}),d=m=>{const w=f.value;return w!==null?w.sum(m):0},p=we(()=>{const m=f.value;return m!==null?Math.min(m.getBound(i.value+l.value)+1,e.value.length-1):0});return nt(Ot,{startIndexRef:v,endIndexRef:p,columnsRef:e,renderColRef:n,renderItemWithColsRef:o,getLeft:d}),{listWidthRef:l,scrollLeftRef:i}}const pt=fe({name:"VirtualListRow",props:{index:{type:Number,required:!0},item:{type:Object,required:!0}},setup(){const{startIndexRef:e,endIndexRef:n,columnsRef:o,getLeft:l,renderColRef:i,renderItemWithColsRef:f}=rt(Ot);return{startIndex:e,endIndex:n,columns:o,renderCol:i,renderItemWithCols:f,getLeft:l}},render(){const{startIndex:e,endIndex:n,columns:o,renderCol:l,renderItemWithCols:i,getLeft:f,item:v}=this;if(i!=null)return i({itemIndex:this.index,startColIndex:e,endColIndex:n,allColumns:o,item:v,getLeft:f});if(l!=null){const d=[];for(let p=e;p<=n;++p){const m=o[p];d.push(l({column:m,left:f(p),item:v}))}return d}return null}}),An=Ye(".v-vl",{maxHeight:"inherit",height:"100%",overflow:"auto",minWidth:"1px"},[Ye("&:not(.v-vl--show-scrollbar)",{scrollbarWidth:"none"},[Ye("&::-webkit-scrollbar, &::-webkit-scrollbar-track-piece, &::-webkit-scrollbar-thumb",{width:0,height:0,display:"none"})])]),Ln=fe({name:"VirtualList",inheritAttrs:!1,props:{showScrollbar:{type:Boolean,default:!0},columns:{type:Array,default:()=>[]},renderCol:Function,renderItemWithCols:Function,items:{type:Array,default:()=>[]},itemSize:{type:Number,required:!0},itemResizable:Boolean,itemsStyle:[String,Object],visibleItemsTag:{type:[String,Object],default:"div"},visibleItemsProps:Object,ignoreItemResize:Boolean,onScroll:Function,onWheel:Function,onResize:Function,defaultScrollKey:[Number,String],defaultScrollIndex:Number,keyField:{type:String,default:"key"},paddingTop:{type:[Number,String],default:0},paddingBottom:{type:[Number,String],default:0}},setup(e){const n=on();An.mount({id:"vueuc/virtual-list",head:!0,anchorMetaName:ln,ssr:n}),Ke(()=>{const{defaultScrollIndex:a,defaultScrollKey:b}=e;a!=null?q({index:a}):b!=null&&q({key:b})});let o=!1,l=!1;rn(()=>{if(o=!1,!l){l=!0;return}q({top:x.value,left:v.value})}),an(()=>{o=!0,l||(l=!0)});const i=we(()=>{if(e.renderCol==null&&e.renderItemWithCols==null||e.columns.length===0)return;let a=0;return e.columns.forEach(b=>{a+=b.width}),a}),f=B(()=>{const a=new Map,{keyField:b}=e;return e.items.forEach((k,N)=>{a.set(k[b],N)}),a}),{scrollLeftRef:v,listWidthRef:d}=Nn({columnsRef:Y(e,"columns"),renderColRef:Y(e,"renderCol"),renderItemWithColsRef:Y(e,"renderItemWithCols")}),p=C(null),m=C(void 0),w=new Map,_=B(()=>{const{items:a,itemSize:b,keyField:k}=e,N=new Ft(a.length,b);return a.forEach((K,L)=>{const D=K[k],$=w.get(D);$!==void 0&&N.add(L,$)}),N}),R=C(0),x=C(0),S=we(()=>Math.max(_.value.getBound(x.value-ot(e.paddingTop))-1,0)),j=B(()=>{const{value:a}=m;if(a===void 0)return[];const{items:b,itemSize:k}=e,N=S.value,K=Math.min(N+Math.ceil(a/k+1),b.length-1),L=[];for(let D=N;D<=K;++D)L.push(b[D]);return L}),q=(a,b)=>{if(typeof a=="number"){W(a,b,"auto");return}const{left:k,top:N,index:K,key:L,position:D,behavior:$,debounce:G=!0}=a;if(k!==void 0||N!==void 0)W(k,N,$);else if(K!==void 0)A(K,$,G);else if(L!==void 0){const s=f.value.get(L);s!==void 0&&A(s,$,G)}else D==="bottom"?W(0,Number.MAX_SAFE_INTEGER,$):D==="top"&&W(0,0,$)};let I,F=null;function A(a,b,k){const{value:N}=_,K=N.sum(a)+ot(e.paddingTop);if(!k)p.value.scrollTo({left:0,top:K,behavior:b});else{I=a,F!==null&&window.clearTimeout(F),F=window.setTimeout(()=>{I=void 0,F=null},16);const{scrollTop:L,offsetHeight:D}=p.value;if(K>L){const $=N.get(a);K+$<=L+D||p.value.scrollTo({left:0,top:K+$-D,behavior:b})}else p.value.scrollTo({left:0,top:K,behavior:b})}}function W(a,b,k){p.value.scrollTo({left:a,top:b,behavior:k})}function H(a,b){var k,N,K;if(o||e.ignoreItemResize||ie(b.target))return;const{value:L}=_,D=f.value.get(a),$=L.get(D),G=(K=(N=(k=b.borderBoxSize)===null||k===void 0?void 0:k[0])===null||N===void 0?void 0:N.blockSize)!==null&&K!==void 0?K:b.contentRect.height;if(G===$)return;G-e.itemSize===0?w.delete(a):w.set(a,G-e.itemSize);const h=G-$;if(h===0)return;L.add(D,h);const E=p.value;if(E!=null){if(I===void 0){const te=L.sum(D);E.scrollTop>te&&E.scrollBy(0,h)}else if(D<I)E.scrollBy(0,h);else if(D===I){const te=L.sum(D);G+te>E.scrollTop+E.offsetHeight&&E.scrollBy(0,h)}ee()}R.value++}const Z=!En();let J=!1;function de(a){var b;(b=e.onScroll)===null||b===void 0||b.call(e,a),(!Z||!J)&&ee()}function ue(a){var b;if((b=e.onWheel)===null||b===void 0||b.call(e,a),Z){const k=p.value;if(k!=null){if(a.deltaX===0&&(k.scrollTop===0&&a.deltaY<=0||k.scrollTop+k.offsetHeight>=k.scrollHeight&&a.deltaY>=0))return;a.preventDefault(),k.scrollTop+=a.deltaY/bt(),k.scrollLeft+=a.deltaX/bt(),ee(),J=!0,sn(()=>{J=!1})}}}function le(a){if(o||ie(a.target))return;if(e.renderCol==null&&e.renderItemWithCols==null){if(a.contentRect.height===m.value)return}else if(a.contentRect.height===m.value&&a.contentRect.width===d.value)return;m.value=a.contentRect.height,d.value=a.contentRect.width;const{onResize:b}=e;b!==void 0&&b(a)}function ee(){const{value:a}=p;a!=null&&(x.value=a.scrollTop,v.value=a.scrollLeft)}function ie(a){let b=a;for(;b!==null;){if(b.style.display==="none")return!0;b=b.parentElement}return!1}return{listHeight:m,listStyle:{overflow:"auto"},keyToIndex:f,itemsStyle:B(()=>{const{itemResizable:a}=e,b=_e(_.value.sum());return R.value,[e.itemsStyle,{boxSizing:"content-box",width:_e(i.value),height:a?"":b,minHeight:a?b:"",paddingTop:_e(e.paddingTop),paddingBottom:_e(e.paddingBottom)}]}),visibleItemsStyle:B(()=>(R.value,{transform:`translateY(${_e(_.value.sum(S.value))})`})),viewportItems:j,listElRef:p,itemsElRef:C(null),scrollTo:q,handleListResize:le,handleListScroll:de,handleListWheel:ue,handleItemResize:H}},render(){const{itemResizable:e,keyField:n,keyToIndex:o,visibleItemsTag:l}=this;return u(ut,{onResize:this.handleListResize},{default:()=>{var i,f;return u("div",nn(this.$attrs,{class:["v-vl",this.showScrollbar&&"v-vl--show-scrollbar"],onScroll:this.handleListScroll,onWheel:this.handleListWheel,ref:"listElRef"}),[this.items.length!==0?u("div",{ref:"itemsElRef",class:"v-vl-items",style:this.itemsStyle},[u(l,Object.assign({class:"v-vl-visible-items",style:this.visibleItemsStyle},this.visibleItemsProps),{default:()=>{const{renderCol:v,renderItemWithCols:d}=this;return this.viewportItems.map(p=>{const m=p[n],w=o.get(m),_=v!=null?u(pt,{index:w,item:p}):void 0,R=d!=null?u(pt,{index:w,item:p}):void 0,x=this.$slots.default({item:p,renderedCols:_,renderedItemWithCols:R,index:w})[0];return e?u(ut,{key:m,onResize:S=>this.handleItemResize(m,S)},{default:()=>x}):(x.key=m,x)})}})]):(f=(i=this.$slots).empty)===null||f===void 0?void 0:f.call(i)])}})}});function Mt(e,n){n&&(Ke(()=>{const{value:o}=e;o&&Je.registerHandler(o,n)}),ye(e,(o,l)=>{l&&Je.unregisterHandler(l)},{deep:!1}),xt(()=>{const{value:o}=e;o&&Je.unregisterHandler(o)}))}function mt(e){switch(typeof e){case"string":return e||void 0;case"number":return String(e);default:return}}function et(e){const n=e.filter(o=>o!==void 0);if(n.length!==0)return n.length===1?n[0]:o=>{e.forEach(l=>{l&&l(o)})}}const Dn=fe({name:"Checkmark",render(){return u("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 16 16"},u("g",{fill:"none"},u("path",{d:"M14.046 3.486a.75.75 0 0 1-.032 1.06l-7.93 7.474a.85.85 0 0 1-1.188-.022l-2.68-2.72a.75.75 0 1 1 1.068-1.053l2.234 2.267l7.468-7.038a.75.75 0 0 1 1.06.032z",fill:"currentColor"})))}}),Vn=fe({props:{onFocus:Function,onBlur:Function},setup(e){return()=>u("div",{style:"width: 0; height: 0",tabindex:0,onFocus:e.onFocus,onBlur:e.onBlur})}}),wt=fe({name:"NBaseSelectGroupHeader",props:{clsPrefix:{type:String,required:!0},tmNode:{type:Object,required:!0}},setup(){const{renderLabelRef:e,renderOptionRef:n,labelFieldRef:o,nodePropsRef:l}=rt(at);return{labelField:o,nodeProps:l,renderLabel:e,renderOption:n}},render(){const{clsPrefix:e,renderLabel:n,renderOption:o,nodeProps:l,tmNode:{rawNode:i}}=this,f=l?.(i),v=n?n(i,!1):Te(i[this.labelField],i,!1),d=u("div",Object.assign({},f,{class:[`${e}-base-select-group-header`,f?.class]}),v);return i.render?i.render({node:d,option:i}):o?o({node:d,option:i,selected:!1}):d}});function Wn(e,n){return u(St,{name:"fade-in-scale-up-transition"},{default:()=>e?u(dn,{clsPrefix:n,class:`${n}-base-select-option__check`},{default:()=>u(Dn)}):null})}const yt=fe({name:"NBaseSelectOption",props:{clsPrefix:{type:String,required:!0},tmNode:{type:Object,required:!0}},setup(e){const{valueRef:n,pendingTmNodeRef:o,multipleRef:l,valueSetRef:i,renderLabelRef:f,renderOptionRef:v,labelFieldRef:d,valueFieldRef:p,showCheckmarkRef:m,nodePropsRef:w,handleOptionClick:_,handleOptionMouseEnter:R}=rt(at),x=we(()=>{const{value:I}=o;return I?e.tmNode.key===I.key:!1});function S(I){const{tmNode:F}=e;F.disabled||_(I,F)}function j(I){const{tmNode:F}=e;F.disabled||R(I,F)}function q(I){const{tmNode:F}=e,{value:A}=x;F.disabled||A||R(I,F)}return{multiple:l,isGrouped:we(()=>{const{tmNode:I}=e,{parent:F}=I;return F&&F.rawNode.type==="group"}),showCheckmark:m,nodeProps:w,isPending:x,isSelected:we(()=>{const{value:I}=n,{value:F}=l;if(I===null)return!1;const A=e.tmNode.rawNode[p.value];if(F){const{value:W}=i;return W.has(A)}else return I===A}),labelField:d,renderLabel:f,renderOption:v,handleMouseMove:q,handleMouseEnter:j,handleClick:S}},render(){const{clsPrefix:e,tmNode:{rawNode:n},isSelected:o,isPending:l,isGrouped:i,showCheckmark:f,nodeProps:v,renderOption:d,renderLabel:p,handleClick:m,handleMouseEnter:w,handleMouseMove:_}=this,R=Wn(o,e),x=p?[p(n,o),f&&R]:[Te(n[this.labelField],n,o),f&&R],S=v?.(n),j=u("div",Object.assign({},S,{class:[`${e}-base-select-option`,n.class,S?.class,{[`${e}-base-select-option--disabled`]:n.disabled,[`${e}-base-select-option--selected`]:o,[`${e}-base-select-option--grouped`]:i,[`${e}-base-select-option--pending`]:l,[`${e}-base-select-option--show-checkmark`]:f}],style:[S?.style||"",n.style||""],onClick:et([m,S?.onClick]),onMouseenter:et([w,S?.onMouseenter]),onMousemove:et([_,S?.onMousemove])}),u("div",{class:`${e}-base-select-option__content`},x));return n.render?n.render({node:j,option:n,selected:o}):d?d({node:j,option:n,selected:o}):j}}),jn=P("base-select-menu",`
 line-height: 1.5;
 outline: none;
 z-index: 0;
 position: relative;
 border-radius: var(--n-border-radius);
 transition:
 background-color .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier);
 background-color: var(--n-color);
`,[P("scrollbar",`
 max-height: var(--n-height);
 `),P("virtual-list",`
 max-height: var(--n-height);
 `),P("base-select-option",`
 min-height: var(--n-option-height);
 font-size: var(--n-option-font-size);
 display: flex;
 align-items: center;
 `,[V("content",`
 z-index: 1;
 white-space: nowrap;
 text-overflow: ellipsis;
 overflow: hidden;
 `)]),P("base-select-group-header",`
 min-height: var(--n-option-height);
 font-size: .93em;
 display: flex;
 align-items: center;
 `),P("base-select-menu-option-wrapper",`
 position: relative;
 width: 100%;
 `),V("loading, empty",`
 display: flex;
 padding: 12px 32px;
 flex: 1;
 justify-content: center;
 `),V("loading",`
 color: var(--n-loading-color);
 font-size: var(--n-loading-size);
 `),V("header",`
 padding: 8px var(--n-option-padding-left);
 font-size: var(--n-option-font-size);
 transition: 
 color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 border-bottom: 1px solid var(--n-action-divider-color);
 color: var(--n-action-text-color);
 `),V("action",`
 padding: 8px var(--n-option-padding-left);
 font-size: var(--n-option-font-size);
 transition: 
 color .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 border-top: 1px solid var(--n-action-divider-color);
 color: var(--n-action-text-color);
 `),P("base-select-group-header",`
 position: relative;
 cursor: default;
 padding: var(--n-option-padding);
 color: var(--n-group-header-text-color);
 `),P("base-select-option",`
 cursor: pointer;
 position: relative;
 padding: var(--n-option-padding);
 transition:
 color .3s var(--n-bezier),
 opacity .3s var(--n-bezier);
 box-sizing: border-box;
 color: var(--n-option-text-color);
 opacity: 1;
 `,[oe("show-checkmark",`
 padding-right: calc(var(--n-option-padding-right) + 20px);
 `),se("&::before",`
 content: "";
 position: absolute;
 left: 4px;
 right: 4px;
 top: 0;
 bottom: 0;
 border-radius: var(--n-border-radius);
 transition: background-color .3s var(--n-bezier);
 `),se("&:active",`
 color: var(--n-option-text-color-pressed);
 `),oe("grouped",`
 padding-left: calc(var(--n-option-padding-left) * 1.5);
 `),oe("pending",[se("&::before",`
 background-color: var(--n-option-color-pending);
 `)]),oe("selected",`
 color: var(--n-option-text-color-active);
 `,[se("&::before",`
 background-color: var(--n-option-color-active);
 `),oe("pending",[se("&::before",`
 background-color: var(--n-option-color-active-pending);
 `)])]),oe("disabled",`
 cursor: not-allowed;
 `,[lt("selected",`
 color: var(--n-option-text-color-disabled);
 `),oe("selected",`
 opacity: var(--n-option-opacity-disabled);
 `)]),V("check",`
 font-size: 16px;
 position: absolute;
 right: calc(var(--n-option-padding-right) - 4px);
 top: calc(50% - 7px);
 color: var(--n-option-check-color);
 transition: color .3s var(--n-bezier);
 `,[Ct({enterScale:"0.5"})])])]),Hn=fe({name:"InternalSelectMenu",props:Object.assign(Object.assign({},Fe.props),{clsPrefix:{type:String,required:!0},scrollable:{type:Boolean,default:!0},treeMate:{type:Object,required:!0},multiple:Boolean,size:{type:String,default:"medium"},value:{type:[String,Number,Array],default:null},autoPending:Boolean,virtualScroll:{type:Boolean,default:!0},show:{type:Boolean,default:!0},labelField:{type:String,default:"label"},valueField:{type:String,default:"value"},loading:Boolean,focusable:Boolean,renderLabel:Function,renderOption:Function,nodeProps:Function,showCheckmark:{type:Boolean,default:!0},onMousedown:Function,onScroll:Function,onFocus:Function,onBlur:Function,onKeyup:Function,onKeydown:Function,onTabOut:Function,onMouseenter:Function,onMouseleave:Function,onResize:Function,resetMenuOnOptionsChange:{type:Boolean,default:!0},inlineThemeDisabled:Boolean,onToggle:Function}),setup(e){const{mergedClsPrefixRef:n,mergedRtlRef:o}=st(e),l=Rt("InternalSelectMenu",o,n),i=Fe("InternalSelectMenu","-internal-select-menu",jn,hn,e,Y(e,"clsPrefix")),f=C(null),v=C(null),d=C(null),p=B(()=>e.treeMate.getFlattenedNodes()),m=B(()=>vn(p.value)),w=C(null);function _(){const{treeMate:s}=e;let h=null;const{value:E}=e;E===null?h=s.getFirstAvailableNode():(e.multiple?h=s.getNode((E||[])[(E||[]).length-1]):h=s.getNode(E),(!h||h.disabled)&&(h=s.getFirstAvailableNode())),b(h||null)}function R(){const{value:s}=w;s&&!e.treeMate.getNode(s.key)&&(w.value=null)}let x;ye(()=>e.show,s=>{s?x=ye(()=>e.treeMate,()=>{e.resetMenuOnOptionsChange?(e.autoPending?_():R(),Tt(k)):R()},{immediate:!0}):x?.()},{immediate:!0}),xt(()=>{x?.()});const S=B(()=>ot(i.value.self[me("optionHeight",e.size)])),j=B(()=>$e(i.value.self[me("padding",e.size)])),q=B(()=>e.multiple&&Array.isArray(e.value)?new Set(e.value):new Set),I=B(()=>{const s=p.value;return s&&s.length===0});function F(s){const{onToggle:h}=e;h&&h(s)}function A(s){const{onScroll:h}=e;h&&h(s)}function W(s){var h;(h=d.value)===null||h===void 0||h.sync(),A(s)}function H(){var s;(s=d.value)===null||s===void 0||s.sync()}function Z(){const{value:s}=w;return s||null}function J(s,h){h.disabled||b(h,!1)}function de(s,h){h.disabled||F(h)}function ue(s){var h;Ee(s,"action")||(h=e.onKeyup)===null||h===void 0||h.call(e,s)}function le(s){var h;Ee(s,"action")||(h=e.onKeydown)===null||h===void 0||h.call(e,s)}function ee(s){var h;(h=e.onMousedown)===null||h===void 0||h.call(e,s),!e.focusable&&s.preventDefault()}function ie(){const{value:s}=w;s&&b(s.getNext({loop:!0}),!0)}function a(){const{value:s}=w;s&&b(s.getPrev({loop:!0}),!0)}function b(s,h=!1){w.value=s,h&&k()}function k(){var s,h;const E=w.value;if(!E)return;const te=m.value(E.key);te!==null&&(e.virtualScroll?(s=v.value)===null||s===void 0||s.scrollTo({index:te}):(h=d.value)===null||h===void 0||h.scrollTo({index:te,elSize:S.value}))}function N(s){var h,E;!((h=f.value)===null||h===void 0)&&h.contains(s.target)&&((E=e.onFocus)===null||E===void 0||E.call(e,s))}function K(s){var h,E;!((h=f.value)===null||h===void 0)&&h.contains(s.relatedTarget)||(E=e.onBlur)===null||E===void 0||E.call(e,s)}nt(at,{handleOptionMouseEnter:J,handleOptionClick:de,valueSetRef:q,pendingTmNodeRef:w,nodePropsRef:Y(e,"nodeProps"),showCheckmarkRef:Y(e,"showCheckmark"),multipleRef:Y(e,"multiple"),valueRef:Y(e,"value"),renderLabelRef:Y(e,"renderLabel"),renderOptionRef:Y(e,"renderOption"),labelFieldRef:Y(e,"labelField"),valueFieldRef:Y(e,"valueField")}),nt(bn,f),Ke(()=>{const{value:s}=d;s&&s.sync()});const L=B(()=>{const{size:s}=e,{common:{cubicBezierEaseInOut:h},self:{height:E,borderRadius:te,color:xe,groupHeaderTextColor:Se,actionDividerColor:ce,optionTextColorPressed:ne,optionTextColor:Ce,optionTextColorDisabled:he,optionTextColorActive:Oe,optionOpacityDisabled:Me,optionCheckColor:Ie,actionTextColor:ke,optionColorPending:ge,optionColorActive:be,loadingColor:ze,loadingSize:Pe,optionColorActivePending:Be,[me("optionFontSize",s)]:Re,[me("optionHeight",s)]:pe,[me("optionPadding",s)]:Q}}=i.value;return{"--n-height":E,"--n-action-divider-color":ce,"--n-action-text-color":ke,"--n-bezier":h,"--n-border-radius":te,"--n-color":xe,"--n-option-font-size":Re,"--n-group-header-text-color":Se,"--n-option-check-color":Ie,"--n-option-color-pending":ge,"--n-option-color-active":be,"--n-option-color-active-pending":Be,"--n-option-height":pe,"--n-option-opacity-disabled":Me,"--n-option-text-color":Ce,"--n-option-text-color-active":Oe,"--n-option-text-color-disabled":he,"--n-option-text-color-pressed":ne,"--n-option-padding":Q,"--n-option-padding-left":$e(Q,"left"),"--n-option-padding-right":$e(Q,"right"),"--n-loading-color":ze,"--n-loading-size":Pe}}),{inlineThemeDisabled:D}=e,$=D?dt("internal-select-menu",B(()=>e.size[0]),L,e):void 0,G={selfRef:f,next:ie,prev:a,getPendingTmNode:Z};return Mt(f,e.onResize),Object.assign({mergedTheme:i,mergedClsPrefix:n,rtlEnabled:l,virtualListRef:v,scrollbarRef:d,itemSize:S,padding:j,flattenedNodes:p,empty:I,virtualListContainer(){const{value:s}=v;return s?.listElRef},virtualListContent(){const{value:s}=v;return s?.itemsElRef},doScroll:A,handleFocusin:N,handleFocusout:K,handleKeyUp:ue,handleKeyDown:le,handleMouseDown:ee,handleVirtualListResize:H,handleVirtualListScroll:W,cssVars:D?void 0:L,themeClass:$?.themeClass,onRender:$?.onRender},G)},render(){const{$slots:e,virtualScroll:n,clsPrefix:o,mergedTheme:l,themeClass:i,onRender:f}=this;return f?.(),u("div",{ref:"selfRef",tabindex:this.focusable?0:-1,class:[`${o}-base-select-menu`,this.rtlEnabled&&`${o}-base-select-menu--rtl`,i,this.multiple&&`${o}-base-select-menu--multiple`],style:this.cssVars,onFocusin:this.handleFocusin,onFocusout:this.handleFocusout,onKeyup:this.handleKeyUp,onKeydown:this.handleKeyDown,onMousedown:this.handleMouseDown,onMouseenter:this.onMouseenter,onMouseleave:this.onMouseleave},ct(e.header,v=>v&&u("div",{class:`${o}-base-select-menu__header`,"data-header":!0,key:"header"},v)),this.loading?u("div",{class:`${o}-base-select-menu__loading`},u(un,{clsPrefix:o,strokeWidth:20})):this.empty?u("div",{class:`${o}-base-select-menu__empty`,"data-empty":!0},fn(e.empty,()=>[u(gn,{theme:l.peers.Empty,themeOverrides:l.peerOverrides.Empty,size:this.size})])):u(cn,{ref:"scrollbarRef",theme:l.peers.Scrollbar,themeOverrides:l.peerOverrides.Scrollbar,scrollable:this.scrollable,container:n?this.virtualListContainer:void 0,content:n?this.virtualListContent:void 0,onScroll:n?void 0:this.doScroll},{default:()=>n?u(Ln,{ref:"virtualListRef",class:`${o}-virtual-list`,items:this.flattenedNodes,itemSize:this.itemSize,showScrollbar:!1,paddingTop:this.padding.top,paddingBottom:this.padding.bottom,onResize:this.handleVirtualListResize,onScroll:this.handleVirtualListScroll,itemResizable:!0},{default:({item:v})=>v.isGroup?u(wt,{key:v.key,clsPrefix:o,tmNode:v}):v.ignored?null:u(yt,{clsPrefix:o,key:v.key,tmNode:v})}):u("div",{class:`${o}-base-select-menu-option-wrapper`,style:{paddingTop:this.padding.top,paddingBottom:this.padding.bottom}},this.flattenedNodes.map(v=>v.isGroup?u(wt,{key:v.key,clsPrefix:o,tmNode:v}):u(yt,{clsPrefix:o,key:v.key,tmNode:v})))}),ct(e.action,v=>v&&[u("div",{class:`${o}-base-select-menu__action`,"data-action":!0,key:"action"},v),u(Vn,{onFocus:this.onTabOut,key:"focus-detector"})]))}}),Kn=se([P("base-selection",`
 --n-padding-single: var(--n-padding-single-top) var(--n-padding-single-right) var(--n-padding-single-bottom) var(--n-padding-single-left);
 --n-padding-multiple: var(--n-padding-multiple-top) var(--n-padding-multiple-right) var(--n-padding-multiple-bottom) var(--n-padding-multiple-left);
 position: relative;
 z-index: auto;
 box-shadow: none;
 width: 100%;
 max-width: 100%;
 display: inline-block;
 vertical-align: bottom;
 border-radius: var(--n-border-radius);
 min-height: var(--n-height);
 line-height: 1.5;
 font-size: var(--n-font-size);
 `,[P("base-loading",`
 color: var(--n-loading-color);
 `),P("base-selection-tags","min-height: var(--n-height);"),V("border, state-border",`
 position: absolute;
 left: 0;
 right: 0;
 top: 0;
 bottom: 0;
 pointer-events: none;
 border: var(--n-border);
 border-radius: inherit;
 transition:
 box-shadow .3s var(--n-bezier),
 border-color .3s var(--n-bezier);
 `),V("state-border",`
 z-index: 1;
 border-color: #0000;
 `),P("base-suffix",`
 cursor: pointer;
 position: absolute;
 top: 50%;
 transform: translateY(-50%);
 right: 10px;
 `,[V("arrow",`
 font-size: var(--n-arrow-size);
 color: var(--n-arrow-color);
 transition: color .3s var(--n-bezier);
 `)]),P("base-selection-overlay",`
 display: flex;
 align-items: center;
 white-space: nowrap;
 pointer-events: none;
 position: absolute;
 top: 0;
 right: 0;
 bottom: 0;
 left: 0;
 padding: var(--n-padding-single);
 transition: color .3s var(--n-bezier);
 `,[V("wrapper",`
 flex-basis: 0;
 flex-grow: 1;
 overflow: hidden;
 text-overflow: ellipsis;
 `)]),P("base-selection-placeholder",`
 color: var(--n-placeholder-color);
 `,[V("inner",`
 max-width: 100%;
 overflow: hidden;
 `)]),P("base-selection-tags",`
 cursor: pointer;
 outline: none;
 box-sizing: border-box;
 position: relative;
 z-index: auto;
 display: flex;
 padding: var(--n-padding-multiple);
 flex-wrap: wrap;
 align-items: center;
 width: 100%;
 vertical-align: bottom;
 background-color: var(--n-color);
 border-radius: inherit;
 transition:
 color .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 `),P("base-selection-label",`
 height: var(--n-height);
 display: inline-flex;
 width: 100%;
 vertical-align: bottom;
 cursor: pointer;
 outline: none;
 z-index: auto;
 box-sizing: border-box;
 position: relative;
 transition:
 color .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
 border-radius: inherit;
 background-color: var(--n-color);
 align-items: center;
 `,[P("base-selection-input",`
 font-size: inherit;
 line-height: inherit;
 outline: none;
 cursor: pointer;
 box-sizing: border-box;
 border:none;
 width: 100%;
 padding: var(--n-padding-single);
 background-color: #0000;
 color: var(--n-text-color);
 transition: color .3s var(--n-bezier);
 caret-color: var(--n-caret-color);
 `,[V("content",`
 text-overflow: ellipsis;
 overflow: hidden;
 white-space: nowrap; 
 `)]),V("render-label",`
 color: var(--n-text-color);
 `)]),lt("disabled",[se("&:hover",[V("state-border",`
 box-shadow: var(--n-box-shadow-hover);
 border: var(--n-border-hover);
 `)]),oe("focus",[V("state-border",`
 box-shadow: var(--n-box-shadow-focus);
 border: var(--n-border-focus);
 `)]),oe("active",[V("state-border",`
 box-shadow: var(--n-box-shadow-active);
 border: var(--n-border-active);
 `),P("base-selection-label","background-color: var(--n-color-active);"),P("base-selection-tags","background-color: var(--n-color-active);")])]),oe("disabled","cursor: not-allowed;",[V("arrow",`
 color: var(--n-arrow-color-disabled);
 `),P("base-selection-label",`
 cursor: not-allowed;
 background-color: var(--n-color-disabled);
 `,[P("base-selection-input",`
 cursor: not-allowed;
 color: var(--n-text-color-disabled);
 `),V("render-label",`
 color: var(--n-text-color-disabled);
 `)]),P("base-selection-tags",`
 cursor: not-allowed;
 background-color: var(--n-color-disabled);
 `),P("base-selection-placeholder",`
 cursor: not-allowed;
 color: var(--n-placeholder-color-disabled);
 `)]),P("base-selection-input-tag",`
 height: calc(var(--n-height) - 6px);
 line-height: calc(var(--n-height) - 6px);
 outline: none;
 display: none;
 position: relative;
 margin-bottom: 3px;
 max-width: 100%;
 vertical-align: bottom;
 `,[V("input",`
 font-size: inherit;
 font-family: inherit;
 min-width: 1px;
 padding: 0;
 background-color: #0000;
 outline: none;
 border: none;
 max-width: 100%;
 overflow: hidden;
 width: 1em;
 line-height: inherit;
 cursor: pointer;
 color: var(--n-text-color);
 caret-color: var(--n-caret-color);
 `),V("mirror",`
 position: absolute;
 left: 0;
 top: 0;
 white-space: pre;
 visibility: hidden;
 user-select: none;
 -webkit-user-select: none;
 opacity: 0;
 `)]),["warning","error"].map(e=>oe(`${e}-status`,[V("state-border",`border: var(--n-border-${e});`),lt("disabled",[se("&:hover",[V("state-border",`
 box-shadow: var(--n-box-shadow-hover-${e});
 border: var(--n-border-hover-${e});
 `)]),oe("active",[V("state-border",`
 box-shadow: var(--n-box-shadow-active-${e});
 border: var(--n-border-active-${e});
 `),P("base-selection-label",`background-color: var(--n-color-active-${e});`),P("base-selection-tags",`background-color: var(--n-color-active-${e});`)]),oe("focus",[V("state-border",`
 box-shadow: var(--n-box-shadow-focus-${e});
 border: var(--n-border-focus-${e});
 `)])])]))]),P("base-selection-popover",`
 margin-bottom: -3px;
 display: flex;
 flex-wrap: wrap;
 margin-right: -8px;
 `),P("base-selection-tag-wrapper",`
 max-width: 100%;
 display: inline-flex;
 padding: 0 7px 3px 0;
 `,[se("&:last-child","padding-right: 0;"),P("tag",`
 font-size: 14px;
 max-width: 100%;
 `,[V("content",`
 line-height: 1.25;
 text-overflow: ellipsis;
 overflow: hidden;
 `)])])]),Un=fe({name:"InternalSelection",props:Object.assign(Object.assign({},Fe.props),{clsPrefix:{type:String,required:!0},bordered:{type:Boolean,default:void 0},active:Boolean,pattern:{type:String,default:""},placeholder:String,selectedOption:{type:Object,default:null},selectedOptions:{type:Array,default:null},labelField:{type:String,default:"label"},valueField:{type:String,default:"value"},multiple:Boolean,filterable:Boolean,clearable:Boolean,disabled:Boolean,size:{type:String,default:"medium"},loading:Boolean,autofocus:Boolean,showArrow:{type:Boolean,default:!0},inputProps:Object,focused:Boolean,renderTag:Function,onKeydown:Function,onClick:Function,onBlur:Function,onFocus:Function,onDeleteOption:Function,maxTagCount:[String,Number],ellipsisTagPopoverProps:Object,onClear:Function,onPatternInput:Function,onPatternFocus:Function,onPatternBlur:Function,renderLabel:Function,status:String,inlineThemeDisabled:Boolean,ignoreComposition:{type:Boolean,default:!0},onResize:Function}),setup(e){const{mergedClsPrefixRef:n,mergedRtlRef:o}=st(e),l=Rt("InternalSelection",o,n),i=C(null),f=C(null),v=C(null),d=C(null),p=C(null),m=C(null),w=C(null),_=C(null),R=C(null),x=C(null),S=C(!1),j=C(!1),q=C(!1),I=Fe("InternalSelection","-internal-selection",Kn,xn,e,Y(e,"clsPrefix")),F=B(()=>e.clearable&&!e.disabled&&(q.value||e.active)),A=B(()=>e.selectedOption?e.renderTag?e.renderTag({option:e.selectedOption,handleClose:()=>{}}):e.renderLabel?e.renderLabel(e.selectedOption,!0):Te(e.selectedOption[e.labelField],e.selectedOption,!0):e.placeholder),W=B(()=>{const r=e.selectedOption;if(r)return r[e.labelField]}),H=B(()=>e.multiple?!!(Array.isArray(e.selectedOptions)&&e.selectedOptions.length):e.selectedOption!==null);function Z(){var r;const{value:g}=i;if(g){const{value:U}=f;U&&(U.style.width=`${g.offsetWidth}px`,e.maxTagCount!=="responsive"&&((r=R.value)===null||r===void 0||r.sync({showAllItemsBeforeCalculate:!1})))}}function J(){const{value:r}=x;r&&(r.style.display="none")}function de(){const{value:r}=x;r&&(r.style.display="inline-block")}ye(Y(e,"active"),r=>{r||J()}),ye(Y(e,"pattern"),()=>{e.multiple&&Tt(Z)});function ue(r){const{onFocus:g}=e;g&&g(r)}function le(r){const{onBlur:g}=e;g&&g(r)}function ee(r){const{onDeleteOption:g}=e;g&&g(r)}function ie(r){const{onClear:g}=e;g&&g(r)}function a(r){const{onPatternInput:g}=e;g&&g(r)}function b(r){var g;(!r.relatedTarget||!(!((g=v.value)===null||g===void 0)&&g.contains(r.relatedTarget)))&&ue(r)}function k(r){var g;!((g=v.value)===null||g===void 0)&&g.contains(r.relatedTarget)||le(r)}function N(r){ie(r)}function K(){q.value=!0}function L(){q.value=!1}function D(r){!e.active||!e.filterable||r.target!==f.value&&r.preventDefault()}function $(r){ee(r)}const G=C(!1);function s(r){if(r.key==="Backspace"&&!G.value&&!e.pattern.length){const{selectedOptions:g}=e;g?.length&&$(g[g.length-1])}}let h=null;function E(r){const{value:g}=i;if(g){const U=r.target.value;g.textContent=U,Z()}e.ignoreComposition&&G.value?h=r:a(r)}function te(){G.value=!0}function xe(){G.value=!1,e.ignoreComposition&&a(h),h=null}function Se(r){var g;j.value=!0,(g=e.onPatternFocus)===null||g===void 0||g.call(e,r)}function ce(r){var g;j.value=!1,(g=e.onPatternBlur)===null||g===void 0||g.call(e,r)}function ne(){var r,g;if(e.filterable)j.value=!1,(r=m.value)===null||r===void 0||r.blur(),(g=f.value)===null||g===void 0||g.blur();else if(e.multiple){const{value:U}=d;U?.blur()}else{const{value:U}=p;U?.blur()}}function Ce(){var r,g,U;e.filterable?(j.value=!1,(r=m.value)===null||r===void 0||r.focus()):e.multiple?(g=d.value)===null||g===void 0||g.focus():(U=p.value)===null||U===void 0||U.focus()}function he(){const{value:r}=f;r&&(de(),r.focus())}function Oe(){const{value:r}=f;r&&r.blur()}function Me(r){const{value:g}=w;g&&g.setTextContent(`+${r}`)}function Ie(){const{value:r}=_;return r}function ke(){return f.value}let ge=null;function be(){ge!==null&&window.clearTimeout(ge)}function ze(){e.active||(be(),ge=window.setTimeout(()=>{H.value&&(S.value=!0)},100))}function Pe(){be()}function Be(r){r||(be(),S.value=!1)}ye(H,r=>{r||(S.value=!1)}),Ke(()=>{Sn(()=>{const r=m.value;r&&(e.disabled?r.removeAttribute("tabindex"):r.tabIndex=j.value?-1:0)})}),Mt(v,e.onResize);const{inlineThemeDisabled:Re}=e,pe=B(()=>{const{size:r}=e,{common:{cubicBezierEaseInOut:g},self:{fontWeight:U,borderRadius:Ue,color:qe,placeholderColor:Ne,textColor:Ae,paddingSingle:Le,paddingMultiple:Ge,caretColor:Xe,colorDisabled:De,textColorDisabled:ve,placeholderColorDisabled:t,colorActive:c,boxShadowFocus:y,boxShadowActive:z,boxShadowHover:O,border:T,borderFocus:M,borderHover:X,borderActive:re,arrowColor:kt,arrowColorDisabled:zt,loadingColor:Pt,colorActiveWarning:Bt,boxShadowFocusWarning:_t,boxShadowActiveWarning:$t,boxShadowHoverWarning:Et,borderWarning:Nt,borderFocusWarning:At,borderHoverWarning:Lt,borderActiveWarning:Dt,colorActiveError:Vt,boxShadowFocusError:Wt,boxShadowActiveError:jt,boxShadowHoverError:Ht,borderError:Kt,borderFocusError:Ut,borderHoverError:qt,borderActiveError:Gt,clearColor:Xt,clearColorHover:Yt,clearColorPressed:Jt,clearSize:Qt,arrowSize:Zt,[me("height",r)]:en,[me("fontSize",r)]:tn}}=I.value,Ve=$e(Le),We=$e(Ge);return{"--n-bezier":g,"--n-border":T,"--n-border-active":re,"--n-border-focus":M,"--n-border-hover":X,"--n-border-radius":Ue,"--n-box-shadow-active":z,"--n-box-shadow-focus":y,"--n-box-shadow-hover":O,"--n-caret-color":Xe,"--n-color":qe,"--n-color-active":c,"--n-color-disabled":De,"--n-font-size":tn,"--n-height":en,"--n-padding-single-top":Ve.top,"--n-padding-multiple-top":We.top,"--n-padding-single-right":Ve.right,"--n-padding-multiple-right":We.right,"--n-padding-single-left":Ve.left,"--n-padding-multiple-left":We.left,"--n-padding-single-bottom":Ve.bottom,"--n-padding-multiple-bottom":We.bottom,"--n-placeholder-color":Ne,"--n-placeholder-color-disabled":t,"--n-text-color":Ae,"--n-text-color-disabled":ve,"--n-arrow-color":kt,"--n-arrow-color-disabled":zt,"--n-loading-color":Pt,"--n-color-active-warning":Bt,"--n-box-shadow-focus-warning":_t,"--n-box-shadow-active-warning":$t,"--n-box-shadow-hover-warning":Et,"--n-border-warning":Nt,"--n-border-focus-warning":At,"--n-border-hover-warning":Lt,"--n-border-active-warning":Dt,"--n-color-active-error":Vt,"--n-box-shadow-focus-error":Wt,"--n-box-shadow-active-error":jt,"--n-box-shadow-hover-error":Ht,"--n-border-error":Kt,"--n-border-focus-error":Ut,"--n-border-hover-error":qt,"--n-border-active-error":Gt,"--n-clear-size":Qt,"--n-clear-color":Xt,"--n-clear-color-hover":Yt,"--n-clear-color-pressed":Jt,"--n-arrow-size":Zt,"--n-font-weight":U}}),Q=Re?dt("internal-selection",B(()=>e.size[0]),pe,e):void 0;return{mergedTheme:I,mergedClearable:F,mergedClsPrefix:n,rtlEnabled:l,patternInputFocused:j,filterablePlaceholder:A,label:W,selected:H,showTagsPanel:S,isComposing:G,counterRef:w,counterWrapperRef:_,patternInputMirrorRef:i,patternInputRef:f,selfRef:v,multipleElRef:d,singleElRef:p,patternInputWrapperRef:m,overflowRef:R,inputTagElRef:x,handleMouseDown:D,handleFocusin:b,handleClear:N,handleMouseEnter:K,handleMouseLeave:L,handleDeleteOption:$,handlePatternKeyDown:s,handlePatternInputInput:E,handlePatternInputBlur:ce,handlePatternInputFocus:Se,handleMouseEnterCounter:ze,handleMouseLeaveCounter:Pe,handleFocusout:k,handleCompositionEnd:xe,handleCompositionStart:te,onPopoverUpdateShow:Be,focus:Ce,focusInput:he,blur:ne,blurInput:Oe,updateCounter:Me,getCounter:Ie,getTail:ke,renderLabel:e.renderLabel,cssVars:Re?void 0:pe,themeClass:Q?.themeClass,onRender:Q?.onRender}},render(){const{status:e,multiple:n,size:o,disabled:l,filterable:i,maxTagCount:f,bordered:v,clsPrefix:d,ellipsisTagPopoverProps:p,onRender:m,renderTag:w,renderLabel:_}=this;m?.();const R=f==="responsive",x=typeof f=="number",S=R||x,j=u(pn,null,{default:()=>u(mn,{clsPrefix:d,loading:this.loading,showArrow:this.showArrow,showClear:this.mergedClearable&&this.selected,onClear:this.handleClear},{default:()=>{var I,F;return(F=(I=this.$slots).arrow)===null||F===void 0?void 0:F.call(I)}})});let q;if(n){const{labelField:I}=this,F=a=>u("div",{class:`${d}-base-selection-tag-wrapper`,key:a.value},w?w({option:a,handleClose:()=>{this.handleDeleteOption(a)}}):u(Qe,{size:o,closable:!a.disabled,disabled:l,onClose:()=>{this.handleDeleteOption(a)},internalCloseIsButtonTag:!1,internalCloseFocusable:!1},{default:()=>_?_(a,!0):Te(a[I],a,!0)})),A=()=>(x?this.selectedOptions.slice(0,f):this.selectedOptions).map(F),W=i?u("div",{class:`${d}-base-selection-input-tag`,ref:"inputTagElRef",key:"__input-tag__"},u("input",Object.assign({},this.inputProps,{ref:"patternInputRef",tabindex:-1,disabled:l,value:this.pattern,autofocus:this.autofocus,class:`${d}-base-selection-input-tag__input`,onBlur:this.handlePatternInputBlur,onFocus:this.handlePatternInputFocus,onKeydown:this.handlePatternKeyDown,onInput:this.handlePatternInputInput,onCompositionstart:this.handleCompositionStart,onCompositionend:this.handleCompositionEnd})),u("span",{ref:"patternInputMirrorRef",class:`${d}-base-selection-input-tag__mirror`},this.pattern)):null,H=R?()=>u("div",{class:`${d}-base-selection-tag-wrapper`,ref:"counterWrapperRef"},u(Qe,{size:o,ref:"counterRef",onMouseenter:this.handleMouseEnterCounter,onMouseleave:this.handleMouseLeaveCounter,disabled:l})):void 0;let Z;if(x){const a=this.selectedOptions.length-f;a>0&&(Z=u("div",{class:`${d}-base-selection-tag-wrapper`,key:"__counter__"},u(Qe,{size:o,ref:"counterRef",onMouseenter:this.handleMouseEnterCounter,disabled:l},{default:()=>`+${a}`})))}const J=R?i?u(ft,{ref:"overflowRef",updateCounter:this.updateCounter,getCounter:this.getCounter,getTail:this.getTail,style:{width:"100%",display:"flex",overflow:"hidden"}},{default:A,counter:H,tail:()=>W}):u(ft,{ref:"overflowRef",updateCounter:this.updateCounter,getCounter:this.getCounter,style:{width:"100%",display:"flex",overflow:"hidden"}},{default:A,counter:H}):x&&Z?A().concat(Z):A(),de=S?()=>u("div",{class:`${d}-base-selection-popover`},R?A():this.selectedOptions.map(F)):void 0,ue=S?Object.assign({show:this.showTagsPanel,trigger:"hover",overlap:!0,placement:"top",width:"trigger",onUpdateShow:this.onPopoverUpdateShow,theme:this.mergedTheme.peers.Popover,themeOverrides:this.mergedTheme.peerOverrides.Popover},p):null,ee=(this.selected?!1:this.active?!this.pattern&&!this.isComposing:!0)?u("div",{class:`${d}-base-selection-placeholder ${d}-base-selection-overlay`},u("div",{class:`${d}-base-selection-placeholder__inner`},this.placeholder)):null,ie=i?u("div",{ref:"patternInputWrapperRef",class:`${d}-base-selection-tags`},J,R?null:W,j):u("div",{ref:"multipleElRef",class:`${d}-base-selection-tags`,tabindex:l?void 0:0},J,j);q=u(wn,null,S?u(yn,Object.assign({},ue,{scrollable:!0,style:"max-height: calc(var(--v-target-height) * 6.6);"}),{trigger:()=>ie,default:de}):ie,ee)}else if(i){const I=this.pattern||this.isComposing,F=this.active?!I:!this.selected,A=this.active?!1:this.selected;q=u("div",{ref:"patternInputWrapperRef",class:`${d}-base-selection-label`,title:this.patternInputFocused?void 0:mt(this.label)},u("input",Object.assign({},this.inputProps,{ref:"patternInputRef",class:`${d}-base-selection-input`,value:this.active?this.pattern:"",placeholder:"",readonly:l,disabled:l,tabindex:-1,autofocus:this.autofocus,onFocus:this.handlePatternInputFocus,onBlur:this.handlePatternInputBlur,onInput:this.handlePatternInputInput,onCompositionstart:this.handleCompositionStart,onCompositionend:this.handleCompositionEnd})),A?u("div",{class:`${d}-base-selection-label__render-label ${d}-base-selection-overlay`,key:"input"},u("div",{class:`${d}-base-selection-overlay__wrapper`},w?w({option:this.selectedOption,handleClose:()=>{}}):_?_(this.selectedOption,!0):Te(this.label,this.selectedOption,!0))):null,F?u("div",{class:`${d}-base-selection-placeholder ${d}-base-selection-overlay`,key:"placeholder"},u("div",{class:`${d}-base-selection-overlay__wrapper`},this.filterablePlaceholder)):null,j)}else q=u("div",{ref:"singleElRef",class:`${d}-base-selection-label`,tabindex:this.disabled?void 0:0},this.label!==void 0?u("div",{class:`${d}-base-selection-input`,title:mt(this.label),key:"input"},u("div",{class:`${d}-base-selection-input__content`},w?w({option:this.selectedOption,handleClose:()=>{}}):_?_(this.selectedOption,!0):Te(this.label,this.selectedOption,!0))):u("div",{class:`${d}-base-selection-placeholder ${d}-base-selection-overlay`,key:"placeholder"},u("div",{class:`${d}-base-selection-placeholder__inner`},this.placeholder)),j);return u("div",{ref:"selfRef",class:[`${d}-base-selection`,this.rtlEnabled&&`${d}-base-selection--rtl`,this.themeClass,e&&`${d}-base-selection--${e}-status`,{[`${d}-base-selection--active`]:this.active,[`${d}-base-selection--selected`]:this.selected||this.active&&this.pattern,[`${d}-base-selection--disabled`]:this.disabled,[`${d}-base-selection--multiple`]:this.multiple,[`${d}-base-selection--focus`]:this.focused}],style:this.cssVars,onClick:this.onClick,onMouseenter:this.handleMouseEnter,onMouseleave:this.handleMouseLeave,onKeydown:this.onKeydown,onFocusin:this.handleFocusin,onFocusout:this.handleFocusout,onMousedown:this.handleMouseDown},q,v?u("div",{class:`${d}-base-selection__border`}):null,v?u("div",{class:`${d}-base-selection__state-border`}):null)}});function He(e){return e.type==="group"}function It(e){return e.type==="ignored"}function tt(e,n){try{return!!(1+n.toString().toLowerCase().indexOf(e.trim().toLowerCase()))}catch{return!1}}function qn(e,n){return{getIsGroup:He,getIgnored:It,getKey(l){return He(l)?l.name||l.key||"key-required":l[e]},getChildren(l){return l[n]}}}function Gn(e,n,o,l){if(!n)return e;function i(f){if(!Array.isArray(f))return[];const v=[];for(const d of f)if(He(d)){const p=i(d[l]);p.length&&v.push(Object.assign({},d,{[l]:p}))}else{if(It(d))continue;n(o,d)&&v.push(d)}return v}return i(e)}function Xn(e,n,o){const l=new Map;return e.forEach(i=>{He(i)?i[o].forEach(f=>{l.set(f[n],f)}):l.set(i[n],i)}),l}const Yn=se([P("select",`
 z-index: auto;
 outline: none;
 width: 100%;
 position: relative;
 font-weight: var(--n-font-weight);
 `),P("select-menu",`
 margin: 4px 0;
 box-shadow: var(--n-menu-box-shadow);
 `,[Ct({originalTransition:"background-color .3s var(--n-bezier), box-shadow .3s var(--n-bezier)"})])]),Jn=Object.assign(Object.assign({},Fe.props),{to:it.propTo,bordered:{type:Boolean,default:void 0},clearable:Boolean,clearFilterAfterSelect:{type:Boolean,default:!0},options:{type:Array,default:()=>[]},defaultValue:{type:[String,Number,Array],default:null},keyboard:{type:Boolean,default:!0},value:[String,Number,Array],placeholder:String,menuProps:Object,multiple:Boolean,size:String,menuSize:{type:String},filterable:Boolean,disabled:{type:Boolean,default:void 0},remote:Boolean,loading:Boolean,filter:Function,placement:{type:String,default:"bottom-start"},widthMode:{type:String,default:"trigger"},tag:Boolean,onCreate:Function,fallbackOption:{type:[Function,Boolean],default:void 0},show:{type:Boolean,default:void 0},showArrow:{type:Boolean,default:!0},maxTagCount:[Number,String],ellipsisTagPopoverProps:Object,consistentMenuWidth:{type:Boolean,default:!0},virtualScroll:{type:Boolean,default:!0},labelField:{type:String,default:"label"},valueField:{type:String,default:"value"},childrenField:{type:String,default:"children"},renderLabel:Function,renderOption:Function,renderTag:Function,"onUpdate:value":[Function,Array],inputProps:Object,nodeProps:Function,ignoreComposition:{type:Boolean,default:!0},showOnFocus:Boolean,onUpdateValue:[Function,Array],onBlur:[Function,Array],onClear:[Function,Array],onFocus:[Function,Array],onScroll:[Function,Array],onSearch:[Function,Array],onUpdateShow:[Function,Array],"onUpdate:show":[Function,Array],displayDirective:{type:String,default:"show"},resetMenuOnOptionsChange:{type:Boolean,default:!0},status:String,showCheckmark:{type:Boolean,default:!0},onChange:[Function,Array],items:Array}),Zn=fe({name:"Select",props:Jn,slots:Object,setup(e){const{mergedClsPrefixRef:n,mergedBorderedRef:o,namespaceRef:l,inlineThemeDisabled:i}=st(e),f=Fe("Select","-select",Yn,Mn,e,n),v=C(e.defaultValue),d=Y(e,"value"),p=vt(d,v),m=C(!1),w=C(""),_=In(e,["items","options"]),R=C([]),x=C([]),S=B(()=>x.value.concat(R.value).concat(_.value)),j=B(()=>{const{filter:t}=e;if(t)return t;const{labelField:c,valueField:y}=e;return(z,O)=>{if(!O)return!1;const T=O[c];if(typeof T=="string")return tt(z,T);const M=O[y];return typeof M=="string"?tt(z,M):typeof M=="number"?tt(z,String(M)):!1}}),q=B(()=>{if(e.remote)return _.value;{const{value:t}=S,{value:c}=w;return!c.length||!e.filterable?t:Gn(t,j.value,c,e.childrenField)}}),I=B(()=>{const{valueField:t,childrenField:c}=e,y=qn(t,c);return kn(q.value,y)}),F=B(()=>Xn(S.value,e.valueField,e.childrenField)),A=C(!1),W=vt(Y(e,"show"),A),H=C(null),Z=C(null),J=C(null),{localeRef:de}=zn("Select"),ue=B(()=>{var t;return(t=e.placeholder)!==null&&t!==void 0?t:de.value.placeholder}),le=[],ee=C(new Map),ie=B(()=>{const{fallbackOption:t}=e;if(t===void 0){const{labelField:c,valueField:y}=e;return z=>({[c]:String(z),[y]:z})}return t===!1?!1:c=>Object.assign(t(c),{value:c})});function a(t){const c=e.remote,{value:y}=ee,{value:z}=F,{value:O}=ie,T=[];return t.forEach(M=>{if(z.has(M))T.push(z.get(M));else if(c&&y.has(M))T.push(y.get(M));else if(O){const X=O(M);X&&T.push(X)}}),T}const b=B(()=>{if(e.multiple){const{value:t}=p;return Array.isArray(t)?a(t):[]}return null}),k=B(()=>{const{value:t}=p;return!e.multiple&&!Array.isArray(t)?t===null?null:a([t])[0]||null:null}),N=Pn(e),{mergedSizeRef:K,mergedDisabledRef:L,mergedStatusRef:D}=N;function $(t,c){const{onChange:y,"onUpdate:value":z,onUpdateValue:O}=e,{nTriggerFormChange:T,nTriggerFormInput:M}=N;y&&ae(y,t,c),O&&ae(O,t,c),z&&ae(z,t,c),v.value=t,T(),M()}function G(t){const{onBlur:c}=e,{nTriggerFormBlur:y}=N;c&&ae(c,t),y()}function s(){const{onClear:t}=e;t&&ae(t)}function h(t){const{onFocus:c,showOnFocus:y}=e,{nTriggerFormFocus:z}=N;c&&ae(c,t),z(),y&&ce()}function E(t){const{onSearch:c}=e;c&&ae(c,t)}function te(t){const{onScroll:c}=e;c&&ae(c,t)}function xe(){var t;const{remote:c,multiple:y}=e;if(c){const{value:z}=ee;if(y){const{valueField:O}=e;(t=b.value)===null||t===void 0||t.forEach(T=>{z.set(T[O],T)})}else{const O=k.value;O&&z.set(O[e.valueField],O)}}}function Se(t){const{onUpdateShow:c,"onUpdate:show":y}=e;c&&ae(c,t),y&&ae(y,t),A.value=t}function ce(){L.value||(Se(!0),A.value=!0,e.filterable&&Le())}function ne(){Se(!1)}function Ce(){w.value="",x.value=le}const he=C(!1);function Oe(){e.filterable&&(he.value=!0)}function Me(){e.filterable&&(he.value=!1,W.value||Ce())}function Ie(){L.value||(W.value?e.filterable?Le():ne():ce())}function ke(t){var c,y;!((y=(c=J.value)===null||c===void 0?void 0:c.selfRef)===null||y===void 0)&&y.contains(t.relatedTarget)||(m.value=!1,G(t),ne())}function ge(t){h(t),m.value=!0}function be(){m.value=!0}function ze(t){var c;!((c=H.value)===null||c===void 0)&&c.$el.contains(t.relatedTarget)||(m.value=!1,G(t),ne())}function Pe(){var t;(t=H.value)===null||t===void 0||t.focus(),ne()}function Be(t){var c;W.value&&(!((c=H.value)===null||c===void 0)&&c.$el.contains(_n(t))||ne())}function Re(t){if(!Array.isArray(t))return[];if(ie.value)return Array.from(t);{const{remote:c}=e,{value:y}=F;if(c){const{value:z}=ee;return t.filter(O=>y.has(O)||z.has(O))}else return t.filter(z=>y.has(z))}}function pe(t){Q(t.rawNode)}function Q(t){if(L.value)return;const{tag:c,remote:y,clearFilterAfterSelect:z,valueField:O}=e;if(c&&!y){const{value:T}=x,M=T[0]||null;if(M){const X=R.value;X.length?X.push(M):R.value=[M],x.value=le}}if(y&&ee.value.set(t[O],t),e.multiple){const T=Re(p.value),M=T.findIndex(X=>X===t[O]);if(~M){if(T.splice(M,1),c&&!y){const X=r(t[O]);~X&&(R.value.splice(X,1),z&&(w.value=""))}}else T.push(t[O]),z&&(w.value="");$(T,a(T))}else{if(c&&!y){const T=r(t[O]);~T?R.value=[R.value[T]]:R.value=le}Ae(),ne(),$(t[O],t)}}function r(t){return R.value.findIndex(y=>y[e.valueField]===t)}function g(t){W.value||ce();const{value:c}=t.target;w.value=c;const{tag:y,remote:z}=e;if(E(c),y&&!z){if(!c){x.value=le;return}const{onCreate:O}=e,T=O?O(c):{[e.labelField]:c,[e.valueField]:c},{valueField:M,labelField:X}=e;_.value.some(re=>re[M]===T[M]||re[X]===T[X])||R.value.some(re=>re[M]===T[M]||re[X]===T[X])?x.value=le:x.value=[T]}}function U(t){t.stopPropagation();const{multiple:c}=e;!c&&e.filterable&&ne(),s(),c?$([],[]):$(null,null)}function Ue(t){!Ee(t,"action")&&!Ee(t,"empty")&&!Ee(t,"header")&&t.preventDefault()}function qe(t){te(t)}function Ne(t){var c,y,z,O,T;if(!e.keyboard){t.preventDefault();return}switch(t.key){case" ":if(e.filterable)break;t.preventDefault();case"Enter":if(!(!((c=H.value)===null||c===void 0)&&c.isComposing)){if(W.value){const M=(y=J.value)===null||y===void 0?void 0:y.getPendingTmNode();M?pe(M):e.filterable||(ne(),Ae())}else if(ce(),e.tag&&he.value){const M=x.value[0];if(M){const X=M[e.valueField],{value:re}=p;e.multiple&&Array.isArray(re)&&re.includes(X)||Q(M)}}}t.preventDefault();break;case"ArrowUp":if(t.preventDefault(),e.loading)return;W.value&&((z=J.value)===null||z===void 0||z.prev());break;case"ArrowDown":if(t.preventDefault(),e.loading)return;W.value?(O=J.value)===null||O===void 0||O.next():ce();break;case"Escape":W.value&&($n(t),ne()),(T=H.value)===null||T===void 0||T.focus();break}}function Ae(){var t;(t=H.value)===null||t===void 0||t.focus()}function Le(){var t;(t=H.value)===null||t===void 0||t.focusInput()}function Ge(){var t;W.value&&((t=Z.value)===null||t===void 0||t.syncPosition())}xe(),ye(Y(e,"options"),xe);const Xe={focus:()=>{var t;(t=H.value)===null||t===void 0||t.focus()},focusInput:()=>{var t;(t=H.value)===null||t===void 0||t.focusInput()},blur:()=>{var t;(t=H.value)===null||t===void 0||t.blur()},blurInput:()=>{var t;(t=H.value)===null||t===void 0||t.blurInput()}},De=B(()=>{const{self:{menuBoxShadow:t}}=f.value;return{"--n-menu-box-shadow":t}}),ve=i?dt("select",void 0,De,e):void 0;return Object.assign(Object.assign({},Xe),{mergedStatus:D,mergedClsPrefix:n,mergedBordered:o,namespace:l,treeMate:I,isMounted:Bn(),triggerRef:H,menuRef:J,pattern:w,uncontrolledShow:A,mergedShow:W,adjustedTo:it(e),uncontrolledValue:v,mergedValue:p,followerRef:Z,localizedPlaceholder:ue,selectedOption:k,selectedOptions:b,mergedSize:K,mergedDisabled:L,focused:m,activeWithoutMenuOpen:he,inlineThemeDisabled:i,onTriggerInputFocus:Oe,onTriggerInputBlur:Me,handleTriggerOrMenuResize:Ge,handleMenuFocus:be,handleMenuBlur:ze,handleMenuTabOut:Pe,handleTriggerClick:Ie,handleToggle:pe,handleDeleteOption:Q,handlePatternInput:g,handleClear:U,handleTriggerBlur:ke,handleTriggerFocus:ge,handleKeydown:Ne,handleMenuAfterLeave:Ce,handleMenuClickOutside:Be,handleMenuScroll:qe,handleMenuKeydown:Ne,handleMenuMousedown:Ue,mergedTheme:f,cssVars:i?void 0:De,themeClass:ve?.themeClass,onRender:ve?.onRender})},render(){return u("div",{class:`${this.mergedClsPrefix}-select`},u(Cn,null,{default:()=>[u(Rn,null,{default:()=>u(Un,{ref:"triggerRef",inlineThemeDisabled:this.inlineThemeDisabled,status:this.mergedStatus,inputProps:this.inputProps,clsPrefix:this.mergedClsPrefix,showArrow:this.showArrow,maxTagCount:this.maxTagCount,ellipsisTagPopoverProps:this.ellipsisTagPopoverProps,bordered:this.mergedBordered,active:this.activeWithoutMenuOpen||this.mergedShow,pattern:this.pattern,placeholder:this.localizedPlaceholder,selectedOption:this.selectedOption,selectedOptions:this.selectedOptions,multiple:this.multiple,renderTag:this.renderTag,renderLabel:this.renderLabel,filterable:this.filterable,clearable:this.clearable,disabled:this.mergedDisabled,size:this.mergedSize,theme:this.mergedTheme.peers.InternalSelection,labelField:this.labelField,valueField:this.valueField,themeOverrides:this.mergedTheme.peerOverrides.InternalSelection,loading:this.loading,focused:this.focused,onClick:this.handleTriggerClick,onDeleteOption:this.handleDeleteOption,onPatternInput:this.handlePatternInput,onClear:this.handleClear,onBlur:this.handleTriggerBlur,onFocus:this.handleTriggerFocus,onKeydown:this.handleKeydown,onPatternBlur:this.onTriggerInputBlur,onPatternFocus:this.onTriggerInputFocus,onResize:this.handleTriggerOrMenuResize,ignoreComposition:this.ignoreComposition},{arrow:()=>{var e,n;return[(n=(e=this.$slots).arrow)===null||n===void 0?void 0:n.call(e)]}})}),u(Tn,{ref:"followerRef",show:this.mergedShow,to:this.adjustedTo,teleportDisabled:this.adjustedTo===it.tdkey,containerClass:this.namespace,width:this.consistentMenuWidth?"target":void 0,minWidth:"target",placement:this.placement},{default:()=>u(St,{name:"fade-in-scale-up-transition",appear:this.isMounted,onAfterLeave:this.handleMenuAfterLeave},{default:()=>{var e,n,o;return this.mergedShow||this.displayDirective==="show"?((e=this.onRender)===null||e===void 0||e.call(this),Fn(u(Hn,Object.assign({},this.menuProps,{ref:"menuRef",onResize:this.handleTriggerOrMenuResize,inlineThemeDisabled:this.inlineThemeDisabled,virtualScroll:this.consistentMenuWidth&&this.virtualScroll,class:[`${this.mergedClsPrefix}-select-menu`,this.themeClass,(n=this.menuProps)===null||n===void 0?void 0:n.class],clsPrefix:this.mergedClsPrefix,focusable:!0,labelField:this.labelField,valueField:this.valueField,autoPending:!0,nodeProps:this.nodeProps,theme:this.mergedTheme.peers.InternalSelectMenu,themeOverrides:this.mergedTheme.peerOverrides.InternalSelectMenu,treeMate:this.treeMate,multiple:this.multiple,size:this.menuSize,renderOption:this.renderOption,renderLabel:this.renderLabel,value:this.mergedValue,style:[(o=this.menuProps)===null||o===void 0?void 0:o.style,this.cssVars],onToggle:this.handleToggle,onScroll:this.handleMenuScroll,onFocus:this.handleMenuFocus,onBlur:this.handleMenuBlur,onKeydown:this.handleMenuKeydown,onTabOut:this.handleMenuTabOut,onMousedown:this.handleMenuMousedown,show:this.mergedShow,showCheckmark:this.showCheckmark,resetMenuOnOptionsChange:this.resetMenuOnOptionsChange}),{empty:()=>{var l,i;return[(i=(l=this.$slots).empty)===null||i===void 0?void 0:i.call(l)]},header:()=>{var l,i;return[(i=(l=this.$slots).header)===null||i===void 0?void 0:i.call(l)]},action:()=>{var l,i;return[(i=(l=this.$slots).action)===null||i===void 0?void 0:i.call(l)]}}),this.displayDirective==="show"?[[On,this.mergedShow],[ht,this.handleMenuClickOutside,void 0,{capture:!0}]]:[[ht,this.handleMenuClickOutside,void 0,{capture:!0}]])):null}})})]}))}});export{Zn as N,Ln as V,Hn as a,qn as c,et as m};
