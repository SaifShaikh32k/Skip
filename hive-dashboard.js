(function(){
  "use strict";

  // ---------------- Config ----------------
  var SHEET_ID = "1VGcAyTHOepHiUQuXVmJCLrbbnx2Mx4eF1XqUwbDcJNA";
  var GID = "0";
  var REFRESH_MS = 60000;
  var PAGE_SIZE = 12;

  // Fixed column order matching the sheet's headers
  var COLS = [
    "source_warehouse","TL_ID","bin_id","zone","fsn",
    "picklist_created_at","picklist_assigned_to","picklist_item_updated_at",
    "picklist_status","IRT_type","reservation_item_status","quantity",
    "wid","cms_vertical","destination_id","date","hour","floor",
    "pathway","aisle","key","key2","qty","shift","destination_type"
  ];

  var COLORS = {
    green:"#3fcf8e", red:"#f0554a", blue:"#4e9de8", amber:"#f2a93b", purple:"#a385f0",
    textDim:"#8393a3", textFaint:"#546174", border:"#232c37", panel:"#161d25"
  };

  // ---------------- State ----------------
  var state = {
    rows: [],
    status: "loading",
    lastSync: null,
    err: "",
    filters: { shift:"ALL", floor:"ALL", pathway:"ALL", irt:"ALL", vertical:"ALL", wid:"ALL", picker:"ALL", hour:"ALL", destType:"ALL", search:"" },
    activeCell: null,
    tablePage: 0
  };
  var autoTimer = null;
  var charts = {};

  // ---------------- Data fetching ----------------
  function parseGviz(text){
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    var json = JSON.parse(text.slice(start, end + 1));
    var rows = (json.table && json.table.rows) || [];
    return rows.map(function(r){
      var obj = {};
      COLS.forEach(function(key, i){
        var cell = r.c[i];
        var v = cell ? (cell.v !== undefined && cell.v !== null ? cell.v : cell.f) : null;
        if (typeof v === "string" && v.indexOf("Date(") === 0) {
          var nums = v.match(/-?\d+/g).map(Number);
          v = new Date(nums[0], nums[1], nums[2], nums[3]||0, nums[4]||0, nums[5]||0).toISOString();
        }
        obj[key] = v;
      });
      return obj;
    });
  }

  function fetchData(){
    state.status = state.rows.length ? state.status : "loading";
    renderStatus();
    var url = "https://docs.google.com/spreadsheets/d/" + SHEET_ID +
      "/gviz/tq?tqx=out:json&gid=" + GID + "&headers=1&_=" + Date.now();
    fetch(url).then(function(res){
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    }).then(function(text){
      state.rows = parseGviz(text);
      state.status = "ok";
      state.lastSync = new Date();
      state.err = "";
      populateFilterOptions();
      renderAll();
    }).catch(function(e){
      state.status = "error";
      state.err = String(e.message || e);
      renderStatus();
    });
  }

  // ---------------- Filtering ----------------
  function getFiltered(){
    var f = state.filters;
    var q = f.search.trim().toLowerCase();
    return state.rows.filter(function(r){
      if (f.shift !== "ALL" && r.shift !== f.shift) return false;
      if (f.floor !== "ALL" && r.floor !== f.floor) return false;
      if (f.pathway !== "ALL" && r.pathway !== f.pathway) return false;
      if (f.irt !== "ALL" && r.IRT_type !== f.irt) return false;
      if (f.vertical !== "ALL" && r.cms_vertical !== f.vertical) return false;
      if (f.wid !== "ALL" && r.wid !== f.wid) return false;
      if (f.picker !== "ALL" && r.picklist_assigned_to !== f.picker) return false;
      if (f.hour !== "ALL" && String(r.hour) !== f.hour) return false;
      if (f.destType !== "ALL" && r.destination_type !== f.destType) return false;
      if (state.activeCell) {
        var c = state.activeCell;
        if (r.floor !== c.floor || r.pathway !== c.pathway || r.aisle !== c.aisle) return false;
      }
      if (q) {
        var hay = (String(r.fsn)+" "+String(r.bin_id)+" "+String(r.TL_ID)+" "+String(r.wid)+" "+String(r.destination_id)+" "+String(r.cms_vertical)).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function uniqueVals(rows, key){
    var set = {};
    rows.forEach(function(r){ if (r[key]) set[r[key]] = true; });
    return Object.keys(set).sort();
  }

  function populateFilterOptions(){
    fillSelect("f-shift", uniqueVals(state.rows, "shift"), state.filters.shift);
    fillSelect("f-floor", uniqueVals(state.rows, "floor"), state.filters.floor);
    fillSelect("f-pathway", uniqueVals(state.rows, "pathway"), state.filters.pathway);
    fillSelect("f-irt", uniqueVals(state.rows, "IRT_type"), state.filters.irt);
    fillSelect("f-vertical", uniqueVals(state.rows, "cms_vertical"), state.filters.vertical);
    fillSelect("f-wid", uniqueVals(state.rows, "wid"), state.filters.wid);
    fillSelect("f-picker", uniqueVals(state.rows, "picklist_assigned_to"), state.filters.picker);
    fillSelect("f-hour", uniqueHours(state.rows), state.filters.hour, function(v){ return (v.length===1?"0"+v:v) + ":00"; });
    fillSelect("f-desttype", uniqueVals(state.rows, "destination_type"), state.filters.destType);
  }

  function uniqueHours(rows){
    var set = {};
    rows.forEach(function(r){ if (r.hour !== null && r.hour !== undefined && r.hour !== "") set[String(r.hour)] = true; });
    return Object.keys(set).sort(function(a,b){ return Number(a) - Number(b); });
  }

  function fillSelect(id, values, current, labelFn){
    var el = document.getElementById(id);
    var existing = Array.prototype.slice.call(el.options).map(function(o){return o.value;});
    if (existing.length - 1 === values.length && values.every(function(v,i){return existing[i+1]===v;})) return;
    el.innerHTML = "";
    var allOpt = document.createElement("option");
    allOpt.value = "ALL"; allOpt.textContent = "All";
    el.appendChild(allOpt);
    values.forEach(function(v){
      var o = document.createElement("option");
      o.value = v; o.textContent = labelFn ? labelFn(v) : v;
      el.appendChild(o);
    });
    el.value = current;
  }

  // ---------------- Rendering ----------------
  function renderStatus(){
    var dot = document.getElementById("liveDot");
    var text = document.getElementById("statusText");
    dot.className = "live-dot " + state.status;
    if (state.status === "ok" && state.lastSync) {
      text.textContent = "Synced " + state.lastSync.toLocaleTimeString();
    } else if (state.status === "loading") {
      text.textContent = "Syncing…";
    } else {
      text.textContent = "Sync failed";
    }
    var banner = document.getElementById("errBanner");
    if (state.status === "error") {
      banner.style.display = "block";
      banner.textContent = "Couldn't reach the sheet: " + state.err + ". Check it's still shared as \"Anyone with the link can view\", then hit Refresh.";
    } else {
      banner.style.display = "none";
    }
  }

  function fmtNum(n){ return n.toLocaleString(); }

  function statusColor(s){
    if (!s) return COLORS.textFaint;
    var u = String(s).toUpperCase();
    if (u.indexOf("COMPLET") !== -1) return COLORS.green;
    if (u.indexOf("CANCEL") !== -1) return COLORS.red;
    if (u.indexOf("PEND") !== -1 || u.indexOf("PROGRESS") !== -1) return COLORS.amber;
    return COLORS.blue;
  }

  function renderKpis(filtered){
    var uniquePicklists = uniqueVals(filtered, "TL_ID").length;
    var uniqueFsn = uniqueVals(filtered, "fsn").length;
    var uniquePickers = uniqueVals(filtered, "picklist_assigned_to").length;
    var uniqueDest = uniqueVals(filtered, "destination_id").length;
    var uniqueVertical = uniqueVals(filtered, "cms_vertical").length;
    var totalQty = filtered.reduce(function(s,r){ return s + (Number(r.qty)||Number(r.quantity)||0); }, 0);

    var items = [
      { label:"Unique Picklists", value: fmtNum(uniquePicklists), color:"var(--blue)" },
      { label:"Unique SKUs", value: fmtNum(uniqueFsn), color:"var(--purple)" },
      { label:"Active Pickers", value: fmtNum(uniquePickers), color:"var(--amber)" },
      { label:"Destinations", value: fmtNum(uniqueDest), color:"var(--text)" },
      { label:"Verticals", value: fmtNum(uniqueVertical), color:"var(--text)" },
      { label:"Total Qty", value: fmtNum(totalQty), color:"var(--green)" }
    ];
    var el = document.getElementById("kpiStrip");
    el.innerHTML = items.map(function(it){
      return '<div class="kpi"><div class="kpi-label">'+it.label+'</div>' +
        '<div class="kpi-value" style="color:'+it.color+'">'+it.value+'</div></div>';
    }).join("");
  }

  function renderHive(filtered){
    var map = {}, max = 1;
    filtered.forEach(function(r){
      var floor = r.floor || "?", path = r.pathway || "?", aisle = r.aisle || "?";
      map[floor] = map[floor] || {};
      map[floor][path] = map[floor][path] || {};
      map[floor][path][aisle] = (map[floor][path][aisle] || 0) + 1;
      if (map[floor][path][aisle] > max) max = map[floor][path][aisle];
    });
    var floors = Object.keys(map).sort();
    var wrap = document.getElementById("hiveWrap");
    if (floors.length === 0) {
      wrap.innerHTML = '<div class="empty">No cells match current filters.</div>';
      return;
    }
    var html = "";
    floors.forEach(function(floor){
      var paths = Object.keys(map[floor]).sort();
      html += '<div><div class="hive-floor-label">FLOOR '+floor+'</div><div>';
      paths.forEach(function(p){
        var aisles = Object.keys(map[floor][p]).sort();
        html += '<div class="hive-path-row"><div class="hive-path-label">'+p+'</div><div class="hive-cells">';
        aisles.forEach(function(a){
          var count = map[floor][p][a];
          var t = count / max;
          var bg = "rgba(242,169,59," + (0.12 + t*0.75).toFixed(2) + ")";
          var key = floor+"|"+p+"|"+a;
          var active = state.activeCell && state.activeCell.key === key;
          html += '<div class="hive-cell'+(active?' hive-cell-active':'')+'" style="background:'+bg+'" ' +
            'data-floor="'+floor+'" data-pathway="'+p+'" data-aisle="'+a+'" data-key="'+key+'" ' +
            'title="Floor '+floor+' · '+p+' · Aisle '+a+' — '+count+' picks">' +
            '<span class="hive-cell-aisle">'+a+'</span><span class="hive-cell-count">'+count+'</span></div>';
        });
        html += '</div></div>';
      });
      html += '</div></div>';
    });
    wrap.innerHTML = html;

    Array.prototype.forEach.call(wrap.querySelectorAll(".hive-cell"), function(cell){
      cell.addEventListener("click", function(){
        var key = cell.getAttribute("data-key");
        if (state.activeCell && state.activeCell.key === key) {
          state.activeCell = null;
        } else {
          state.activeCell = { floor: cell.getAttribute("data-floor"), pathway: cell.getAttribute("data-pathway"), aisle: cell.getAttribute("data-aisle"), key: key };
        }
        state.tablePage = 0;
        renderAll();
      });
    });

    var clearBtn = document.getElementById("clearCellBtn");
    if (state.activeCell) {
      clearBtn.style.display = "inline-flex";
      clearBtn.textContent = "✕ " + state.activeCell.floor + "/" + state.activeCell.pathway + "/" + state.activeCell.aisle;
      clearBtn.onclick = function(){ state.activeCell = null; state.tablePage = 0; renderAll(); };
    } else {
      clearBtn.style.display = "none";
    }
  }

  function baseChartOptions(){
    return {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false },
        tooltip:{ backgroundColor:COLORS.panel, borderColor:COLORS.border, borderWidth:1, titleColor:"#e9eef3", bodyColor:"#c7d0da", padding:8 } }
    };
  }

  function upsertChart(id, config){
    var canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;
    var ctx = canvas.getContext("2d");
    if (charts[id]) { charts[id].destroy(); }
    charts[id] = new Chart(ctx, config);
  }

  function countBy(rows, key, limit){
    var map = {};
    rows.forEach(function(r){ var v = r[key] || "unknown"; map[v] = (map[v]||0)+1; });
    var arr = Object.keys(map).map(function(k){ return {name:k, value:map[k]}; }).sort(function(a,b){return b.value-a.value;});
    return limit ? arr.slice(0, limit) : arr;
  }

  function renderHourly(filtered){
    var byHour = {};
    filtered.forEach(function(r){
      var h = Number(r.hour);
      if (isNaN(h)) return;
      byHour[h] = (byHour[h]||0) + 1;
    });
    var labels = [], data = [];
    for (var h=0; h<24; h++){ labels.push((h<10?"0"+h:h)+":00"); data.push(byHour[h]||0); }
    var opts = baseChartOptions();
    opts.interaction = { mode:"index", intersect:false };
    opts.scales = {
      x:{ ticks:{ color:COLORS.textFaint, font:{size:9.5}, maxRotation:0, autoSkip:true, maxTicksLimit:12 }, grid:{ display:false } },
      y:{ ticks:{ color:COLORS.textFaint, font:{size:9.5} }, grid:{ color:COLORS.border }, beginAtZero:true }
    };
    upsertChart("chartHourly", { type:"line", data:{ labels:labels, datasets:[{
      data:data, borderColor:COLORS.amber, backgroundColor:"rgba(242,169,59,0.14)",
      fill:true, tension:0.35, pointRadius:2, pointBackgroundColor:COLORS.amber, borderWidth:2
    }] }, options:opts });
  }

  function renderTopWid(filtered){
    var data = countBy(filtered, "wid", 10);
    var opts = baseChartOptions();
    opts.indexAxis = "y";
    opts.scales = {
      x:{ ticks:{ color:COLORS.textFaint, font:{size:9.5} }, grid:{ color:COLORS.border } },
      y:{ ticks:{ color:COLORS.textDim, font:{size:10, family:"IBM Plex Mono"} }, grid:{ display:false } }
    };
    upsertChart("chartTopWid", { type:"bar", data:{ labels:data.map(function(d){return d.name;}),
      datasets:[{ data:data.map(function(d){return d.value;}), backgroundColor:COLORS.purple, borderRadius:3, maxBarThickness:16 }] }, options:opts });
  }

  function renderTopPicker(filtered){
    var data = countBy(filtered, "picklist_assigned_to", 10);
    var opts = baseChartOptions();
    opts.indexAxis = "y";
    opts.scales = {
      x:{ ticks:{ color:COLORS.textFaint, font:{size:9.5} }, grid:{ color:COLORS.border } },
      y:{ ticks:{ color:COLORS.textDim, font:{size:10, family:"IBM Plex Mono"} }, grid:{ display:false } }
    };
    upsertChart("chartTopPicker", { type:"bar", data:{ labels:data.map(function(d){return d.name;}),
      datasets:[{ data:data.map(function(d){return d.value;}), backgroundColor:COLORS.blue, borderRadius:3, maxBarThickness:16 }] }, options:opts });
  }

  function renderTable(filtered){
    var sorted = filtered.slice().sort(function(a,b){
      return String(b.picklist_item_updated_at||"").localeCompare(String(a.picklist_item_updated_at||""));
    });
    var maxPage = Math.max(0, Math.ceil(sorted.length / PAGE_SIZE) - 1);
    if (state.tablePage > maxPage) state.tablePage = maxPage;
    var pageRows = sorted.slice(state.tablePage*PAGE_SIZE, (state.tablePage+1)*PAGE_SIZE);

    var body = document.getElementById("tableBody");
    if (!pageRows.length) {
      body.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:18px;color:var(--text-faint);">No rows match current filters.</td></tr>';
    } else {
      body.innerHTML = pageRows.map(function(r){
        return '<tr>' +
          '<td class="mono-cell">'+ (r.picklist_item_updated_at||"") +'</td>' +
          '<td class="mono-cell">'+ (r.TL_ID||"") +'</td>' +
          '<td class="mono-cell">'+ (r.bin_id||"") +'</td>' +
          '<td>'+ (r.pathway||"") +'</td>' +
          '<td class="mono-cell">'+ (r.fsn||"") +'</td>' +
          '<td class="mono-cell">'+ (r.wid||"") +'</td>' +
          '<td>'+ (r.cms_vertical||"") +'</td>' +
          '<td><span class="badge" style="background:'+statusColor(r.IRT_type)+'22;color:'+statusColor(r.IRT_type)+'">'+(r.IRT_type||"")+'</span></td>' +
          '<td class="mono-cell">'+ (r.destination_id||"") +'</td>' +
          '<td class="mono-cell">'+ (r.picklist_assigned_to||"") +'</td>' +
          '<td class="mono-cell">'+ (r.qty || r.quantity || "") +'</td>' +
        '</tr>';
      }).join("");
    }
    document.getElementById("pageInfo").textContent = "Page " + (sorted.length ? state.tablePage+1 : 0) + " of " + (maxPage+1);
    document.getElementById("prevPage").disabled = state.tablePage === 0;
    document.getElementById("nextPage").disabled = state.tablePage >= maxPage;
  }

  function renderFilterMeta(){
    document.getElementById("filterCount").textContent = state.rows.length.toLocaleString() + " rows loaded · " + getFiltered().length.toLocaleString() + " in view";
    var f = state.filters;
    var anyActive = f.shift!=="ALL" || f.floor!=="ALL" || f.pathway!=="ALL" || f.irt!=="ALL" || f.vertical!=="ALL" || f.wid!=="ALL" || f.picker!=="ALL" || f.hour!=="ALL" || f.destType!=="ALL" || f.search || state.activeCell;
    document.getElementById("clearFiltersBtn").style.display = anyActive ? "inline-flex" : "none";
  }

  function renderAll(){
    var filtered = getFiltered();
    safe(renderStatus);
    safe(function(){ renderKpis(filtered); });
    safe(function(){ renderHive(filtered); });
    safe(function(){ renderTable(filtered); });
    safe(function(){ renderFilterMeta(); });
    safe(function(){ renderTopWid(filtered); });
    safe(function(){ renderTopPicker(filtered); });
    safe(function(){ renderHourly(filtered); });
  }

  function safe(fn){
    try { fn(); } catch (e) { console.error("HIVE render error:", e); }
  }

  // ---------------- Events ----------------
  function bindFilter(id, key){
    document.getElementById(id).addEventListener("change", function(e){
      state.filters[key] = e.target.value;
      state.tablePage = 0;
      renderAll();
    });
  }
  bindFilter("f-shift", "shift");
  bindFilter("f-floor", "floor");
  bindFilter("f-pathway", "pathway");
  bindFilter("f-irt", "irt");
  bindFilter("f-vertical", "vertical");
  bindFilter("f-wid", "wid");
  bindFilter("f-picker", "picker");
  bindFilter("f-hour", "hour");
  bindFilter("f-desttype", "destType");

  var searchTimer;
  document.getElementById("f-search").addEventListener("input", function(e){
    clearTimeout(searchTimer);
    var val = e.target.value;
    searchTimer = setTimeout(function(){
      state.filters.search = val;
      state.tablePage = 0;
      renderAll();
    }, 200);
  });

  document.getElementById("clearFiltersBtn").addEventListener("click", function(){
    state.filters = { shift:"ALL", floor:"ALL", pathway:"ALL", irt:"ALL", vertical:"ALL", wid:"ALL", picker:"ALL", hour:"ALL", destType:"ALL", search:"" };
    state.activeCell = null;
    state.tablePage = 0;
    document.getElementById("f-search").value = "";
    ["f-shift","f-floor","f-pathway","f-irt","f-vertical","f-wid","f-picker","f-hour","f-desttype"].forEach(function(id){ document.getElementById(id).value = "ALL"; });
    renderAll();
  });

  document.getElementById("refreshBtn").addEventListener("click", fetchData);

  document.getElementById("autoRefreshToggle").addEventListener("change", function(e){
    if (e.target.checked) {
      autoTimer = setInterval(fetchData, REFRESH_MS);
    } else {
      clearInterval(autoTimer);
    }
  });

  document.getElementById("filtersToggleBtn").addEventListener("click", function(){
    document.getElementById("filterBar").classList.toggle("open");
  });

  document.getElementById("prevPage").addEventListener("click", function(){
    if (state.tablePage > 0) { state.tablePage--; renderTable(getFiltered()); document.getElementById("pageInfo").scrollIntoView({block:"nearest"}); }
  });
  document.getElementById("nextPage").addEventListener("click", function(){
    state.tablePage++; renderTable(getFiltered());
  });

  // ---------------- Init ----------------
  fetchData();
  autoTimer = setInterval(fetchData, REFRESH_MS);
})();
