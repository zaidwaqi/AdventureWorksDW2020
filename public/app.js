(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const diagram = document.getElementById("diagram");
  const content = document.getElementById("diagram-content");
  const canvasWrap = document.getElementById("canvas-wrap");
  const canvasState = document.getElementById("canvas-state");
  const searchInput = document.getElementById("search-input");
  const schemaFilter = document.getElementById("schema-filter");
  const connectionPill = document.getElementById("connection-pill");
  const zoomLevel = document.getElementById("zoom-level");
  const cardWidth = 264;
  const laneWidth = 330;
  const laneGap = 48;
  const cardGap = 24;
  const headerHeight = 48;
  const diagramColumns = 3;
  const previewColumns = 7;
  const maxPreviewColumns = 14;

  let tables = [];
  let relationships = [];
  let nodes = new Map();
  let visibleKeys = null;
  const picked = new Set(["DimEmployee", "DimEmployeeSalesTerritory", "DimProduct", "DimReseller", "DimSalesTerritory", "FactResellerSales"].map((name) => `dbo.${name}`));
  const pickerButton = document.getElementById("picker-button");
  const pickerMenu = document.getElementById("picker-menu");
  const pickerSearch = document.getElementById("picker-search");
  const pickerList = document.getElementById("picker-list");
  const pickerCount = document.getElementById("picker-count");
  let view = { x: 0, y: 0, scale: 1 };
  let drag = null;

  function svgElement(tag, attributes = {}, text) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setConnection(state, label) {
    connectionPill.className = `connection-pill ${state}`;
    connectionPill.querySelector("span").textContent = label;
  }

  function errorMessage(message) {
    canvasState.classList.add("error");
    canvasState.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = "Couldn’t load the database schema";
    const detail = document.createElement("span");
    detail.textContent = message;
    const tip = document.createElement("span");
    tip.textContent = "Check your SQL Server settings and restart the local server.";
    canvasState.append(title, detail, tip);
    setConnection("error", "Connection issue");
  }

  function shownColumns(table) {
    const key = tableKey(table);
    const keyed = new Set(table.columns.filter((column) => column.primaryKey).map((column) => column.name));
    relationships.forEach((relation) => {
      if (relation.from === key) relation.columns.forEach((column) => keyed.add(column.from));
      if (relation.to === key) relation.columns.forEach((column) => keyed.add(column.to));
    });
    const ordered = [
      ...table.columns.filter((column) => keyed.has(column.name)),
      ...table.columns.filter((column) => !keyed.has(column.name)),
    ];
    return ordered.slice(0, Math.min(maxPreviewColumns, Math.max(previewColumns, keyed.size)));
  }

  function columnHeight(table, shown) {
    const bodyEnd = headerHeight + shown.length * 20 + 4;
    return table.columns.length > shown.length ? bodyEnd + 24 : bodyEnd + 6;
  }

  function columnY(node, name) {
    const index = node.shown.findIndex((column) => column.name === name);
    return node.y + headerHeight + 14 + Math.max(0, index) * 20;
  }

  function tableKey(table) {
    return `${table.schema}.${table.name}`;
  }

  function cardinality(relation) {
    return relation.oneToOne ? { from: "1", to: "1", text: "One-to-one" } : { from: "*", to: "1", text: "Many-to-one" };
  }

  function foreignKeyColumns(key) {
    const names = new Set();
    relationships.forEach((relation) => {
      if (relation.from === key) relation.columns.forEach((column) => names.add(column.from));
    });
    return names;
  }

  function layoutTables() {
    const shownTables = tables.filter((table) => visibleKeys.has(tableKey(table)));
    const schemas = [...new Set(shownTables.map((table) => table.schema))].sort();
    nodes = new Map();
    const columnCount = Math.max(1, Math.min(diagramColumns, shownTables.length));
    const headings = [];
    let y = 0;
    schemas.forEach((schema) => {
      const schemaTables = shownTables.filter((table) => table.schema === schema)
        .sort((a, b) => a.name.localeCompare(b.name));
      const cols = Math.min(columnCount, schemaTables.length);
      const colY = new Array(cols).fill(y + 55);
      headings.push({ schema, y: y + 28, cols });
      schemaTables.forEach((table) => {
        let c = 0;
        for (let i = 1; i < cols; i++) if (colY[i] < colY[c]) c = i;
        const shown = shownColumns(table);
        const height = columnHeight(table, shown);
        const key = `${table.schema}.${table.name}`;
        nodes.set(key, { x: 30 + c * (laneWidth + laneGap), y: colY[c], width: cardWidth, height, table, shown });
        colY[c] += height + cardGap;
      });
      y = Math.max(...colY) + 10;
    });

    const width = Math.max(900, 30 + columnCount * (laneWidth + laneGap));
    const height = Math.max(660, y + 20);
    content.setAttribute("viewBox", `0 0 ${width} ${height}`);
    content.replaceChildren();

    headings.forEach(({ schema, y: hy, cols }) => {
      const rightEdge = 30 + (cols - 1) * (laneWidth + laneGap) + cardWidth;
      content.append(
        svgElement("text", { x: 32, y: hy, class: "schema-heading" }, schema.toUpperCase()),
        svgElement("line", { x1: 30, y1: hy + 10, x2: rightEdge, y2: hy + 10, class: "schema-rule" }),
      );
    });

    drawRelationships();
    for (const node of nodes.values()) drawTable(node);
    updateViewBox();
  }

  function drawRelationships() {
    const group = svgElement("g", { "aria-hidden": "true" });
    const stride = laneWidth + laneGap;
    const colOf = (node) => Math.round((node.x - 30) / stride);
    const edges = [];
    relationships.forEach((relationship) => {
      const from = nodes.get(relationship.from);
      const to = nodes.get(relationship.to);
      if (!from || !to) return;
      const fc = colOf(from);
      const tc = colOf(to);
      let fromSide = "right";
      let toSide = "left";
      let gap = fc;
      if (fc === tc) toSide = "right";
      else if (fc > tc) { fromSide = "left"; toSide = "right"; gap = fc - 1; }
      edges.push({ relationship, from, to, fromSide, toSide, gap });
    });

    edges.forEach((edge) => {
      edge.startY = columnY(edge.from, edge.relationship.columns[0].from);
      edge.endY = columnY(edge.to, edge.relationship.columns[0].to);
    });

    const lanes = new Map();
    edges.forEach((edge) => {
      if (!lanes.has(edge.gap)) lanes.set(edge.gap, []);
      lanes.get(edge.gap).push(edge);
    });
    lanes.forEach((list, gap) => {
      list.sort((a, b) => (a.startY + a.endY) - (b.startY + b.endY));
      const left = 30 + gap * stride + cardWidth;
      const width = stride - cardWidth;
      list.forEach((edge, index) => {
        edge.laneX = left + width * (index + 1) / (list.length + 1);
        const offset = ((index % 4) - 1.5) * 3;
        edge.startY += offset;
        edge.endY += offset;
      });
    });

    edges.forEach(({ relationship, from, to, fromSide, toSide, startY, endY, laneX }) => {
      const startX = fromSide === "right" ? from.x + from.width : from.x;
      const endX = toSide === "right" ? to.x + to.width : to.x;
      const path = svgElement("path", {
        d: `M ${startX} ${startY} L ${laneX} ${startY} L ${laneX} ${endY} L ${endX} ${endY}`,
        class: "relationship-path",
        "data-from": relationship.from,
        "data-to": relationship.to,
      });
      const columns = relationship.columns.map((column) => `${column.from} ? ${column.to}`).join(", ");
      path.append(svgElement("title", {}, `${cardinality(relationship).text} · ${relationship.name}: ${relationship.from} (${columns}) ? ${relationship.to}`));
      group.append(path);
      group.append(
        svgElement("circle", { cx: startX, cy: startY, r: 3, class: "relationship-dot relationship-mark", "data-from": relationship.from, "data-to": relationship.to }),
        svgElement("circle", { cx: endX, cy: endY, r: 3, class: "relationship-dot relationship-mark", "data-from": relationship.from, "data-to": relationship.to }),
      );
      const marks = cardinality(relationship);
      const mark = (text, x, y, side) => svgElement("text", {
        x: side === "right" ? x + 6 : x - 6,
        y: y - 4,
        "text-anchor": side === "right" ? "start" : "end",
        class: "cardinality-label relationship-mark",
        "data-from": relationship.from,
        "data-to": relationship.to,
      }, text);
      group.append(mark(marks.from, startX, startY, fromSide), mark(marks.to, endX, endY, toSide));
    });
    content.append(group);
  }
  function drawTable(node) {
    const { table, x, y, width, height } = node;
    const key = `${table.schema}.${table.name}`;
    const group = svgElement("g", {
      class: "table-card",
      transform: `translate(${x} ${y})`,
      "data-table": key,
      tabindex: "0",
      role: "button",
      "aria-label": `${table.schema}.${table.name}, ${table.columns.length} columns`,
    });
    group.append(
      svgElement("rect", { x: 0, y: 0, width, height, rx: 8, class: "card-outline", filter: "url(#card-shadow)" }),
      svgElement("rect", { x: 14, y: 14, width: 19, height: 19, rx: 5, fill: "#eff2ff" }),
      svgElement("path", { d: "M19 18h9v10h-9zM19 21h9M22 18v10", fill: "none", stroke: "#7083e9", "stroke-width": 1 }),
      svgElement("text", { x: 42, y: 23, class: "card-title" }, table.name),
      svgElement("text", { x: 42, y: 36, class: "card-schema" }, table.schema),
      svgElement("line", { x1: 0, y1: headerHeight, x2: width, y2: headerHeight, class: "card-header-rule" }),
    );

    const fkNames = foreignKeyColumns(key);
    node.shown.forEach((column, index) => {
      const rowY = headerHeight + 17 + index * 20;
      const badge = column.primaryKey ? "PK" : fkNames.has(column.name) ? "FK" : "";
      if (badge) group.append(svgElement("text", { x: 13, y: rowY, class: badge === "PK" ? "key-badge pk" : "key-badge fk" }, badge));
      group.append(
        svgElement("text", { x: 36, y: rowY, class: "column-label" }, truncate(column.name, 21)),
        svgElement("text", { x: width - 11, y: rowY, class: "column-type-label", "text-anchor": "end" }, truncate(column.type, 15)),
      );
      if (index < node.shown.length - 1) {
        group.append(svgElement("line", { x1: 12, y1: rowY + 7, x2: width - 12, y2: rowY + 7, class: "column-row-rule" }));
      }
    });

    if (table.columns.length > node.shown.length) {
      group.append(svgElement("text", {
        x: 14,
        y: height - 9,
        class: "card-more",
      }, `+ ${table.columns.length - node.shown.length} more columns`));
    }

    group.addEventListener("pointerenter", () => setHover(key));
    group.addEventListener("pointerleave", () => setHover(null));
    group.addEventListener("focus", () => setHover(key));
    group.addEventListener("blur", () => setHover(null));
    content.append(group);
  }

  function truncate(value, maxLength) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
  }

  function updateViewBox() {
    const bounds = content.getAttribute("viewBox").split(" ").map(Number);
    const [width, height] = bounds.slice(2);
    const viewportWidth = canvasWrap.clientWidth || 900;
    const viewportHeight = canvasWrap.clientHeight || 570;
    const visibleWidth = viewportWidth / view.scale;
    const visibleHeight = viewportHeight / view.scale;
    const maxX = Math.max(0, width - visibleWidth);
    const maxY = Math.max(0, height - visibleHeight);
    view.x = Math.min(maxX, Math.max(0, view.x));
    view.y = Math.min(maxY, Math.max(0, view.y));
    diagram.setAttribute("viewBox", `${view.x} ${view.y} ${visibleWidth} ${visibleHeight}`);
    zoomLevel.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function setZoom(scale, anchorX, anchorY) {
    const nextScale = Math.min(2.2, Math.max(0.45, scale));
    if (nextScale === view.scale) return;
    const rect = diagram.getBoundingClientRect();
    const x = anchorX === undefined ? rect.width / 2 : anchorX - rect.left;
    const y = anchorY === undefined ? rect.height / 2 : anchorY - rect.top;
    const diagramX = view.x + x / view.scale;
    const diagramY = view.y + y / view.scale;
    view.scale = nextScale;
    view.x = diagramX - x / view.scale;
    view.y = diagramY - y / view.scale;
    updateViewBox();
  }

  function fitDiagram() {
    const [,, width, height] = content.getAttribute("viewBox").split(" ").map(Number);
    const rect = canvasWrap.getBoundingClientRect();
    view.scale = Math.min(1, (rect.width - 30) / width, (rect.height - 30) / height);
    view.x = 0;
    view.y = 0;
    updateViewBox();
  }

  function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const schema = schemaFilter.value;
    const matches = new Set();
    tables.forEach((table) => {
      const key = tableKey(table);
      const matchesSchema = !schema || table.schema === schema;
      const matchesQuery = !query || key.toLowerCase().includes(query)
        || table.columns.some((column) => column.name.toLowerCase().includes(query));
      if (matchesSchema && matchesQuery) matches.add(key);
    });
    const next = new Set(matches);
    if (query) {
      relationships.forEach((relation) => {
        if (matches.has(relation.from)) next.add(relation.to);
        if (matches.has(relation.to)) next.add(relation.from);
      });
    }
    if (picked.size) [...next].forEach((key) => { if (!picked.has(key)) next.delete(key); });
    const changed = !visibleKeys || next.size !== visibleKeys.size || [...next].some((key) => !visibleKeys.has(key));
    if (changed) {
      visibleKeys = next;
      layoutTables();
      view = { x: 0, y: 0, scale: 1 };
      updateViewBox();
    }
    content.querySelectorAll(".table-card").forEach((card) => {
      const key = card.dataset.table;
      card.classList.toggle("search-hit", !!query && matches.has(key));
    });
    if (!next.size) {
      content.append(svgElement("text", { x: 50, y: 110, class: "empty-result" }, "No matching tables or columns"));
    }
  }
  function setHover(key) {
    const linked = new Set();
    if (key) {
      linked.add(key);
      relationships.forEach((relation) => {
        if (relation.from === key) linked.add(relation.to);
        if (relation.to === key) linked.add(relation.from);
      });
    }
    content.classList.toggle("hovering", !!key);
    content.querySelectorAll(".table-card").forEach((card) => {
      card.classList.toggle("linked", linked.has(card.dataset.table));
      card.classList.toggle("hovered", card.dataset.table === key);
    });
    content.querySelectorAll(".relationship-path").forEach((path) => {
      path.classList.toggle("active", !!key && (path.dataset.from === key || path.dataset.to === key));
    });
    content.querySelectorAll(".relationship-mark").forEach((mark) => {
      mark.classList.toggle("active", !!key && (mark.dataset.from === key || mark.dataset.to === key));
    });
  }

  function renderPicker() {
    const filter = pickerSearch.value.trim().toLowerCase();
    pickerList.replaceChildren();
    let lastSchema = null;
    [...tables].sort((a, b) => tableKey(a).localeCompare(tableKey(b))).forEach((table) => {
      const key = tableKey(table);
      if (filter && !key.toLowerCase().includes(filter)) return;
      if (table.schema !== lastSchema) {
        lastSchema = table.schema;
        const heading = document.createElement("div");
        heading.className = "picker-heading";
        heading.textContent = table.schema.toUpperCase();
        pickerList.append(heading);
      }
      const row = document.createElement("label");
      row.className = "picker-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.table = key;
      box.checked = picked.has(key);
      box.addEventListener("change", () => {
        if (box.checked) picked.add(key); else picked.delete(key);
        pickerChanged();
      });
      const name = document.createElement("span");
      name.textContent = table.name;
      row.append(box, name);
      pickerList.append(row);
    });
  }

  function pickerChanged() {
    pickerCount.textContent = picked.size ? String(picked.size) : "All";
    pickerButton.classList.toggle("active", picked.size > 0);
    applyFilters();
  }

  pickerButton.addEventListener("click", () => {
    pickerMenu.hidden = !pickerMenu.hidden;
    pickerButton.setAttribute("aria-expanded", String(!pickerMenu.hidden));
    if (!pickerMenu.hidden) pickerSearch.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!pickerMenu.hidden && !document.getElementById("table-picker").contains(event.target)) {
      pickerMenu.hidden = true;
      pickerButton.setAttribute("aria-expanded", "false");
    }
  });
  pickerSearch.addEventListener("input", renderPicker);
  document.getElementById("picker-all").addEventListener("click", () => {
    pickerList.querySelectorAll("input[type=checkbox]").forEach((box) => picked.add(box.dataset.table));
    renderPicker();
    pickerChanged();
  });
  document.getElementById("picker-clear").addEventListener("click", () => {
    picked.clear();
    renderPicker();
    pickerChanged();
  });

  async function loadSchema() {
    try {
      let response = await fetch("api/schema");
      if (response.status === 404) response = await fetch("schema.json");
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || result.error || "Unexpected server response.");
      tables = result.tables;
      relationships = result.relationships;
      if (tables.length === 0) throw new Error("No tables were visible to this login. Check database access and VIEW DEFINITION permissions.");
      canvasState.remove();
      setConnection("connected", "Connected");
      document.getElementById("table-count").textContent = tables.length;
      document.getElementById("relation-count").textContent = relationships.length;
      document.getElementById("schema-count").textContent = new Set(tables.map((table) => table.schema)).size;
      const schemas = [...new Set(tables.map((table) => table.schema))].sort();
      schemas.forEach((schema) => {
        const option = document.createElement("option");
        option.value = schema;
        option.textContent = schema;
        schemaFilter.append(option);
      });
      renderPicker();
      pickerChanged();
    } catch (error) {
      errorMessage(error.message);
    }
  }

  searchInput.addEventListener("input", applyFilters);
  schemaFilter.addEventListener("change", applyFilters);
  document.getElementById("zoom-in").addEventListener("click", () => setZoom(view.scale * 1.2));
  document.getElementById("zoom-out").addEventListener("click", () => setZoom(view.scale / 1.2));
  document.getElementById("fit-button").addEventListener("click", fitDiagram);
  canvasWrap.addEventListener("wheel", (event) => {
    if (!tables.length) return;
    event.preventDefault();
    setZoom(view.scale * (event.deltaY < 0 ? 1.08 : 0.92), event.clientX, event.clientY);
  }, { passive: false });
  diagram.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".table-card")) return;
    drag = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    diagram.classList.add("dragging");
    diagram.setPointerCapture(event.pointerId);
  });
  diagram.addEventListener("pointermove", (event) => {
    if (!drag) return;
    view.x = drag.viewX - (event.clientX - drag.x) / view.scale;
    view.y = drag.viewY - (event.clientY - drag.y) / view.scale;
    updateViewBox();
  });
  diagram.addEventListener("pointerup", () => {
    drag = null;
    diagram.classList.remove("dragging");
  });
  document.addEventListener("keydown", (event) => {
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName);
    if (event.key === "/" && !typing) {
      event.preventDefault();
      searchInput.focus();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === "Escape" && document.activeElement === searchInput) {
      searchInput.value = "";
      searchInput.blur();
      applyFilters();
    }
  });
  window.addEventListener("resize", updateViewBox);

  loadSchema();
})();
