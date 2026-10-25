"use strict";

// Same key as your previous version, so saved vehicles remain available.
const STORAGE_KEY = "flip-vehicles-v2";
const $ = selector => document.querySelector(selector);
const cleanNumber = value => Math.max(0, Number(value) || 0);
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
const money = value => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2
}).format(value);
const repairTotal = car => roundMoney(car.repairs.reduce((sum, item) => sum + item.cost, 0));
const investment = car => roundMoney(car.purchase + repairTotal(car));
const revenue = car => car.status === "Sold" ? car.sale : car.expected;
const profit = car => roundMoney(revenue(car) - investment(car));
const makeId = () => `car-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};
const statuses = ["Active", "In Repair", "Ready for Sale", "Sold"];
const categories = {
  "Body & paint": ["Front Bumper", "Rear Bumper", "Hood", "Fender", "Quarter Panel", "Full Body Paint"],
  "Mechanical": ["Engine repair", "Transmission", "OBD-II diagnosis", "Brakes", "Suspension", "Air conditioning"],
  "Other costs": ["Tires", "Windshield", "Detailing", "Auction fees", "Transport", "Other fees"]
};
const presetNames = Object.values(categories).flat();
let vehicles = [];
let filter = "All";
let editingId = null;
let selectedId = null;
let toastTimer;
let decodeController = null;
let decodeVersion = 0;
let storageWritable = true;

function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").hidden = true, 3500);
}
function normalizeCar(car) {
  return {
    ...car,
    id: car.id || makeId(), name: car.name || "Imported vehicle",
    vin: car.vin || "", year: car.year || "", make: car.make || "", model: car.model || "",
    trim: car.trim || "", type: car.type || "", engine: car.engine || "", drive: car.drive || "",
    date: car.date || "", mileage: car.mileage == null || car.mileage === "" ? null : cleanNumber(car.mileage),
    purchase: cleanNumber(car.purchase), expected: cleanNumber(car.expected),
    repairs: Array.isArray(car.repairs) ? car.repairs.map(item => ({...item, name: String(item.name || "Repair"), cost: cleanNumber(item.cost)})) : [],
    status: statuses.includes(car.status) ? car.status : "Active", sale: car.sale == null ? null : cleanNumber(car.sale), obd: car.obd || ""
  };
}
function importOldCards() {
  const old = JSON.parse(localStorage.getItem("flip-cars") || "[]");
  if (!Array.isArray(old)) return [];
  return old.map(card => {
    const fields = {};
    (card.details || []).forEach(line => {
      const colon = line.indexOf(":");
      if (colon >= 0) fields[line.slice(0,colon).trim()] = line.slice(colon+1).trim();
    });
    return normalizeCar({name:card.name, vin:fields.VIN, year:fields.Year, make:fields.Make,
      model:fields.Model, trim:fields.Trim, type:fields.Type, engine:fields.Engine,
      mileage:fields.Mileage ? Number(fields.Mileage.replace(/[^0-9.]/g,"")) : null, imported:true});
  });
}
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw === null ? importOldCards() : JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("Invalid saved data");
    vehicles = data.map(normalizeCar);
  } catch {
    storageWritable = false;
    $("#storage-message").textContent = "Saved data could not be read. It has not been overwritten. Download a backup before changing storage settings.";
  }
}
function saveData() {
  if (!storageWritable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles));
    $("#storage-message").textContent = "";
    return true;
  } catch {
    $("#storage-message").textContent = "Browser storage unavailable. Download a backup; changes currently last for this session only.";
    return false;
  }
}

// Navigation and summaries.
const pageText = {
  home:["Flip smarter.","Know every dollar in your next deal."],
  inventory:["Your inventory.","Every vehicle, from purchase to profit."],
  buying:["Buy with clarity.","Run the numbers before your next deal."]
};
function switchView(view) {
  ["home","inventory","buying"].forEach(name => $(`#${name}-view`).hidden = name !== view);
  document.querySelectorAll("[data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active",active);
    if (active) button.setAttribute("aria-current","page"); else button.removeAttribute("aria-current");
  });
  $("#page-title").textContent = pageText[view][0];
  $("#page-subtitle").textContent = pageText[view][1];
  window.scrollTo({top:0,behavior:"smooth"});
}
function createCard(car) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "vehicle-card";
  card.setAttribute("aria-label",`View ${car.name}`);
  // Fixed markup only. User-entered text is always assigned with textContent.
  card.innerHTML = '<div class="vehicle-header"><div><h3></h3><p></p></div><span class="status-badge"></span></div><div class="vehicle-totals"><div><span>Total in</span><strong class="card-total"></strong></div><div><span class="profit-label"></span><strong class="card-profit orange"></strong></div></div>';
  card.querySelector("h3").textContent = car.name;
  card.querySelector("p").textContent = car.date ? `Bought ${car.date}` : "Purchase date not entered";
  card.querySelector(".status-badge").textContent = car.status;
  card.querySelector(".status-badge").classList.toggle("sold",car.status === "Sold");
  card.querySelector(".card-total").textContent = car.imported ? "Not entered" : money(investment(car));
  card.querySelector(".profit-label").textContent = car.status === "Sold" ? "Realized profit" : "Est. profit";
  card.querySelector(".card-profit").textContent = car.imported ? "Not entered" : `${profit(car)>=0?"+":""}${money(profit(car))}`;
  card.querySelector(".card-profit").classList.toggle("negative",profit(car)<0);
  card.addEventListener("click",() => openDetails(car.id));
  return card;
}
function fillList(selector, list) {
  const container = $(selector);
  container.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No vehicles here yet. Add a vehicle to start tracking your flips.";
    container.append(empty);
  } else list.forEach(car => container.append(createCard(car)));
}
function render() {
  const active = vehicles.filter(car => car.status !== "Sold");
  const knownActive = active.filter(car => !car.imported);
  const sold = vehicles.filter(car => car.status === "Sold" && !car.imported);
  const projected = knownActive.reduce((s,car)=>s+profit(car),0);
  $("#total-invested").textContent = money(knownActive.reduce((s,car)=>s+investment(car),0));
  $("#active-count").textContent = `${active.length} active flip${active.length===1?"":"s"}`;
  $("#projected-profit").textContent = `${projected>=0?"+":""}${money(projected)} projected`;
  $("#repair-total").textContent = money(knownActive.reduce((s,car)=>s+repairTotal(car),0));
  $("#realized-profit").textContent = money(sold.reduce((s,car)=>s+profit(car),0));
  $("#sold-count").textContent = `${sold.length} sold`;
  $("#inventory-count").textContent = `${vehicles.length} vehicles`;
  fillList("#recent-list",[...active].reverse());
  fillList("#inventory-list",[...vehicles].reverse().filter(car=>filter==="All"||car.status===filter));
}

// Repair controls. The same editor is used to create and update vehicles.
function buildChecklist() {
  Object.entries(categories).forEach(([category,names]) => {
    const heading = document.createElement("h3");
    heading.className = "repair-heading";
    heading.textContent = category;
    $("#repair-checklist").append(heading);
    names.forEach(name => {
      const row = document.createElement("div"); row.className = "repair-row"; row.dataset.name = name;
      const label = document.createElement("label");
      const checkbox = document.createElement("input"); checkbox.type = "checkbox";
      label.append(checkbox,document.createTextNode(name));
      const cost = document.createElement("input");
      cost.className="repair-cost";cost.type="number";cost.min="0";cost.step=".01";cost.placeholder="$0";cost.disabled=true;
      cost.setAttribute("aria-label",`${name} estimated cost`);
      checkbox.addEventListener("change",()=>{cost.disabled=!checkbox.checked;updateTotals();});
      cost.addEventListener("input",updateTotals);
      row.append(label,cost);$("#repair-checklist").append(row);
    });
  });
}
function addCustomRepair(name="", cost="", focus=true, original=null) {
  const row = document.createElement("div"); row.className="custom-row";
  // Keep any additional saved properties attached to an existing repair.
  row.repairOriginal = original;
  const title=document.createElement("input"); title.className="custom-name"; title.placeholder="Repair / expense";title.value=name;
  title.setAttribute("aria-label","Custom repair name");
  const amount=document.createElement("input");amount.className="custom-cost";amount.type="number";amount.min="0";amount.step=".01";amount.placeholder="$0";amount.value=cost;
  amount.setAttribute("aria-label","Custom repair cost");
  const remove=document.createElement("button");remove.type="button";remove.className="remove-repair";remove.textContent="×";remove.setAttribute("aria-label","Remove custom repair");
  remove.addEventListener("click",()=>{row.remove();updateTotals();$("#add-custom-repair").focus();});
  amount.addEventListener("input",updateTotals);
  row.append(title,amount,remove);$("#custom-repairs").append(row);
  if(focus) title.focus();
  updateTotals();
}
function getRepairs() {
  const presets=[...document.querySelectorAll(".repair-row")].filter(row=>row.querySelector("[type=checkbox]").checked)
    .map(row=>({...row.repairOriginal,name:row.dataset.name,cost:roundMoney(cleanNumber(row.querySelector(".repair-cost").value))}));
  const custom=[...document.querySelectorAll(".custom-row")].filter(row=>row.querySelector(".custom-name").value.trim())
    .map(row=>({...row.repairOriginal,name:row.querySelector(".custom-name").value.trim(),cost:roundMoney(cleanNumber(row.querySelector(".custom-cost").value))}));
  return [...presets,...custom];
}
function updateTotals() {
  const repairs=getRepairs().reduce((sum,item)=>sum+item.cost,0);
  const total=cleanNumber($("#vehicle-purchase").value)+repairs;
  const sold=$("#vehicle-status").value==="Sold";
  const sale=cleanNumber($(sold?"#vehicle-sale":"#vehicle-expected").value);
  $("#form-total").textContent=money(total);
  $("#form-profit").textContent=`${money(repairs)} repairs + fees · ${money(sale-total)} ${sold?"realized":"estimated"} profit`;
}
const fieldMap={vin:"vin",year:"year",make:"make",model:"model",trim:"trim",type:"type",engine:"engine",drive:"drive",mileage:"mileage",name:"name",date:"date",purchase:"purchase",expected:"expected",status:"status",sale:"sale",obd:"obd"};
function setStep(step, focus=false) {
  $("#vehicle-step").hidden=step!==1;$("#repair-step").hidden=step!==2;
  $("#details-tab").classList.toggle("active",step===1);$("#repairs-tab").classList.toggle("active",step===2);
  $("#details-tab").setAttribute("aria-pressed",String(step===1));$("#repairs-tab").setAttribute("aria-pressed",String(step===2));
  $("#vehicle-form-panel").scrollTop=0;
  if(focus) $(step===1?"#vehicle-name":"#add-custom-repair").focus();
}
function toggleSale() {
  const sold=$("#vehicle-status").value==="Sold";
  $("#sale-field").hidden=!sold;$("#vehicle-sale").required=sold;updateTotals();
}
function stopDecoding() {
  decodeVersion++;
  if(decodeController)decodeController.abort();
  decodeController=null;$("#decode-vin-button").disabled=false;
}
function openEditor(id=null, step=1) {
  stopDecoding(); editingId=id;
  const car=id?vehicles.find(item=>item.id===id):null;
  if(id&&!car)return;
  $("#vehicle-form").reset();$("#custom-repairs").replaceChildren();$("#form-error").textContent="";
  $("#editor-title").textContent=car?"Edit vehicle":"Add a vehicle";
  $("#editor-caption").textContent=car?"Update details, fixes, and prices":"Build your next flip";
  $("#save-vehicle").textContent=car?"Save changes":"Save vehicle";
  $("#vin-message").textContent="Decode online, or enter details manually.";
  document.querySelectorAll(".repair-row").forEach(row=>{
    row.querySelector("[type=checkbox]").checked=false;row.querySelector(".repair-cost").value="";row.querySelector(".repair-cost").disabled=true;row.repairOriginal=null;
  });
  $("#vehicle-date").value=today();
  if(car){
    Object.entries(fieldMap).forEach(([field,key])=>{
      $(`#vehicle-${field}`).value=car.imported&&["purchase","expected"].includes(field)?"":(car[key]??"");
    });
    const used=new Set();
    car.repairs.forEach(item=>{
      const row=[...document.querySelectorAll(".repair-row")].find(row=>row.dataset.name===item.name);
      if(row&&!used.has(item.name)){
        row.querySelector("[type=checkbox]").checked=true;row.querySelector(".repair-cost").disabled=false;row.querySelector(".repair-cost").value=item.cost;row.repairOriginal={...item};used.add(item.name);
      }else addCustomRepair(item.name,item.cost,false,{...item});
    });
  }
  toggleSale();setStep(step);updateTotals();
  $("#vehicle-form-panel").showModal();
}
function validateEditor() {
  $("#form-error").textContent="";
  for(const input of $("#vehicle-step").querySelectorAll("input,select")){
    if(!input.checkValidity()){
      setStep(1);input.reportValidity();input.focus();$("#form-error").textContent="Check the highlighted vehicle field.";return false;
    }
  }
  if(!$("#vehicle-name").value.trim()){
    setStep(1);$("#vehicle-name").focus();$("#form-error").textContent="Enter a vehicle name.";return false;
  }
  for(const input of $("#repair-step").querySelectorAll("input")){
    if(!input.disabled&&!input.checkValidity()){
      setStep(2);input.reportValidity();input.focus();return false;
    }
  }
  for(const row of document.querySelectorAll(".custom-row")){
    const name=row.querySelector(".custom-name");const cost=row.querySelector(".custom-cost");
    if(!name.value.trim()){
      setStep(2);name.focus();$("#form-error").textContent="Name your custom repair, or remove the empty row.";return false;
    }
    if(cost.value===""){
      setStep(2);cost.focus();$("#form-error").textContent="Enter a cost for each custom repair (0 is allowed).";return false;
    }
  }
  return true;
}
function saveEditor(event) {
  event.preventDefault();if(!validateEditor())return;
  const old=editingId?vehicles.find(car=>car.id===editingId):{};
  const updated={...old,id:editingId||makeId(),imported:false};
  Object.entries(fieldMap).forEach(([field,key])=>updated[key]=$(`#vehicle-${field}`).value.trim());
  updated.purchase=roundMoney(cleanNumber(updated.purchase));updated.expected=roundMoney(cleanNumber(updated.expected));
  updated.mileage=updated.mileage===""?null:cleanNumber(updated.mileage);
  updated.sale=updated.status==="Sold"?roundMoney(cleanNumber(updated.sale)):null;
  updated.vin=updated.vin.toUpperCase();updated.repairs=getRepairs();
  if(editingId)vehicles=vehicles.map(car=>car.id===editingId?updated:car);else vehicles.push(updated);
  const saved=saveData();render();$("#vehicle-form-panel").close();
  notify(saved?(editingId?"Vehicle and costs updated.":"Vehicle added to your garage."):"Updated for this session. Download a backup to keep changes.");
}

// Vehicle detail view: edit everything or jump straight to costs.
function addDetail(label,value){
  const row=document.createElement("div");row.className="detail-row";
  const title=document.createElement("span");title.textContent=label;
  const text=document.createElement("strong");text.textContent=value;
  row.append(title,text);$("#detail-content").append(row);
}
function openDetails(id){
  const car=vehicles.find(item=>item.id===id);if(!car)return;selectedId=id;
  $("#detail-title").textContent=car.name;$("#detail-content").replaceChildren();
  addDetail("Status",car.status);addDetail("VIN",car.vin||"Not entered");
  addDetail("Year / make / model",[car.year,car.make,car.model].filter(Boolean).join(" ")||"Not entered");
  addDetail("Trim",car.trim||"Not entered");addDetail("Type",car.type||"Not entered");addDetail("Engine",car.engine||"Not entered");addDetail("Drivetrain",car.drive||"Not entered");
  addDetail("Mileage",car.mileage==null?"Not entered":`${Number(car.mileage).toLocaleString()} miles`);
  addDetail("Purchased",car.date||"Not entered");addDetail("Purchase price",car.imported?"Not entered":money(car.purchase));
  const heading=document.createElement("h3");heading.className="repair-heading";heading.textContent="Repair plan + costs";$("#detail-content").append(heading);
  if(!car.repairs.length)addDetail("Repairs","None yet — add fixes above");
  car.repairs.forEach(item=>addDetail(item.name,money(item.cost)));
  if(car.obd)addDetail("OBD-II / notes",car.obd);
  if(car.imported){
    const note=document.createElement("p");note.className="helper";note.textContent="Imported from your earlier version. Use Edit vehicle to add purchase and expected sale prices.";$("#detail-content").append(note);
  }else{
    addDetail("Total in",money(investment(car)));addDetail(car.status==="Sold"?"Actual sale price":"Expected sale price",money(revenue(car)));
    addDetail(car.status==="Sold"?"Realized profit":"Estimated profit",money(profit(car)));
    addDetail("Profit margin",revenue(car)>0?`${(profit(car)/revenue(car)*100).toFixed(1)}%`:"—");
  }
  $("#detail-dialog").showModal();
}

// Real VIN lookup. Never overwrite prices, repairs, status, or mileage.
async function decodeVin(){
  const vin=$("#vehicle-vin").value.trim().toUpperCase();$("#vehicle-vin").value=vin;
  if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)){$("#vin-message").textContent="Enter 17 characters without I, O, or Q.";return;}
  stopDecoding();const version=decodeVersion;const controller=new AbortController();decodeController=controller;
  $("#decode-vin-button").disabled=true;$("#vin-message").textContent="Looking up your vehicle…";
  const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,{signal:controller.signal});
    if(!response.ok)throw new Error("Lookup failed");const data=await response.json();if(version!==decodeVersion)return;
    const car=data.Results?.[0];if(!car?.Make||!car?.Model){$("#vin-message").textContent="Vehicle not found. Check the VIN or enter details manually.";return;}
    const map={year:car.ModelYear,make:car.Make,model:car.Model,trim:car.Trim,type:car.BodyClass||car.VehicleType,drive:car.DriveType};
    Object.entries(map).forEach(([field,value])=>$(`#vehicle-${field}`).value=value||"");
    const liters=Number.parseFloat(car.DisplacementL);$("#vehicle-engine").value=Number.isFinite(liters)?`${liters.toFixed(1)} L`:"";
    // Keep an existing custom name on edits.
    if(!editingId||!$("#vehicle-name").value.trim())$("#vehicle-name").value=[car.ModelYear,car.Make,car.Model].filter(Boolean).join(" ");
    $("#vin-message").textContent=car.ErrorCode==="0"?"Details filled. Review and complete missing fields.":"Partial results. Check the VIN and review every field.";
  }catch(error){if(version===decodeVersion)$("#vin-message").textContent="Lookup unavailable or timed out. Try again or enter details manually.";}
  finally{clearTimeout(timeout);if(version===decodeVersion){$("#decode-vin-button").disabled=false;decodeController=null;}}
}
function calculateBuying(){
  const market=cleanNumber($("#buy-market").value),price=cleanNumber($("#buy-price").value),repairs=cleanNumber($("#buy-repairs").value);
  const target=Math.min(100,Math.max(1,cleanNumber($("#buy-target").value)));
  const total=price+repairs,gain=market-total,margin=market>0?gain/market*100:0,max=market*(1-target/100)-repairs;
  const panel=$("#buy-decision");panel.classList.remove("caution","pass");
  let title,description;
  if(market<=0){title="Enter market value";description="Add an expected sale value to evaluate the deal.";panel.classList.add("caution");}
  else if(margin>=target){title="BUY";description=`Meets your ${target}% target margin on these estimates. Verify vehicle condition and all costs before buying.`;}
  else if(gain>0&&margin>=target/2){title="NEGOTIATE";description="Potential profit, but below target. Aim for the maximum purchase price below.";panel.classList.add("caution");}
  else{title="PASS";description="The estimated return is too thin for your target. A lower purchase price or repair bill could change the result.";panel.classList.add("pass");}
  $("#buy-recommendation").textContent=title;$("#buy-explanation").textContent=description;$("#buy-profit").textContent=money(gain);$("#buy-total").textContent=money(total);$("#buy-margin").textContent=`${margin.toFixed(1)}%`;$("#buy-max").textContent=max>=0?money(max):"Repairs exceed target budget";
}

// Wire up controls.
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.view)));
document.querySelectorAll("[data-add]").forEach(button=>button.addEventListener("click",()=>openEditor()));
["All",...statuses].forEach(status=>{
  const button=document.createElement("button");button.type="button";button.className="filter";button.textContent=status;
  button.classList.toggle("active",status===filter);button.setAttribute("aria-pressed",String(status===filter));
  button.addEventListener("click",()=>{filter=status;document.querySelectorAll(".filter").forEach(item=>{item.classList.toggle("active",item===button);item.setAttribute("aria-pressed",String(item===button));});render();});
  $("#inventory-filters").append(button);
});
["#close-editor","#cancel-editor"].forEach(selector=>$(selector).addEventListener("click",()=>$("#vehicle-form-panel").close()));
$("#vehicle-form-panel").addEventListener("close",stopDecoding);
$("#details-tab").addEventListener("click",()=>setStep(1));$("#repairs-tab").addEventListener("click",()=>setStep(2));
$("#next-step").addEventListener("click",()=>setStep(2,true));$("#back-step").addEventListener("click",()=>setStep(1,true));
$("#add-custom-repair").addEventListener("click",()=>addCustomRepair());
$("#vehicle-form").addEventListener("submit",saveEditor);
$("#vehicle-status").addEventListener("change",toggleSale);
["purchase","expected","sale"].forEach(field=>$(`#vehicle-${field}`).addEventListener("input",updateTotals));
$("#decode-vin-button").addEventListener("click",decodeVin);
$("#vehicle-vin").addEventListener("input",()=>{stopDecoding();$("#vin-message").textContent="Click Decode VIN after entering the full VIN.";});
$("#close-detail").addEventListener("click",()=>$("#detail-dialog").close());
$("#edit-vehicle").addEventListener("click",()=>{$("#detail-dialog").close();openEditor(selectedId,1);});
$("#edit-repairs").addEventListener("click",()=>{$("#detail-dialog").close();openEditor(selectedId,2);});
["market","price","repairs","target"].forEach(field=>$(`#buy-${field}`).addEventListener("input",calculateBuying));
$("#export-backup").addEventListener("click",()=>{
  let raw=null;try{raw=localStorage.getItem(STORAGE_KEY);}catch{}
  const content=storageWritable?JSON.stringify(vehicles,null,2):(raw||JSON.stringify(vehicles,null,2));
  const url=URL.createObjectURL(new Blob([content],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download=`flip-backup-${today()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
buildChecklist();loadData();render();calculateBuying();
