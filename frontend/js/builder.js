document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const rightPanel = document.getElementById('right-panel');
    const openPanelBtn = document.getElementById('open-nodes-panel-btn');
    const closePanelBtn = document.getElementById('close-panel-btn');
    const canvasContainer = document.getElementById('canvas-container');
    const canvasInner = document.getElementById('canvas-inner');
    const svgCanvas = document.getElementById('svg-canvas');
    const nodesContainer = document.getElementById('nodes-container');
    const tempLine = document.getElementById('temp-connection-line');
    const panelSearchContainer = document.getElementById('panel-search-container');
    const panelContent = document.getElementById('panel-content');
    const settingsTemplate = document.getElementById('node-settings-template');
    const panelTitle = document.getElementById('panel-title');
    
    // Buttons
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomFit = document.getElementById('btn-zoom-fit');
    const zoomLevelText = document.getElementById('zoom-level-text');
    const btnExecute = document.getElementById('btn-execute');
    const btnShare = document.getElementById('btn-share');
    const btnSaveNode = document.getElementById('btn-save-node');

    // --- State ---
    let nodeIdCounter = 1;
    let nodes = {}; // { id: { el, x, y, type, title } }
    let connections = []; // { id, fromId, toId, pathEl }
    
    let activeNode = null;
    let activeConnection = null;

    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startPanX = 0, startPanY = 0;

    let draggedNode = null;
    let nodeOffsetX = 0, nodeOffsetY = 0;

    let isDrawingConnection = false;
    let drawingStartNodeId = null;
    let drawingStartPort = null; 
    let drawingStartX = 0, drawingStartY = 0;

    // --- Initialization ---
    if (typeof hrNodeCategories !== 'undefined') {
        renderNodeLibrary();
    }
    updateCanvasTransform();
    bindNavButtons();

    // ==========================================
    // 1. PANNING & ZOOMING
    // ==========================================
    
    canvasContainer.addEventListener('mousedown', (e) => {
        if (e.target === canvasContainer || e.target === canvasInner || e.target === svgCanvas) {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            canvasContainer.style.cursor = 'grabbing';
            clearSelection();
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isPanning) {
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            updateCanvasTransform();
        }
        
        if (draggedNode) {
            const innerRect = canvasInner.getBoundingClientRect();
            let newX = (e.clientX - innerRect.left - nodeOffsetX) / zoom;
            let newY = (e.clientY - innerRect.top - nodeOffsetY) / zoom;
            
            // Grid Snapping (20px)
            newX = Math.round(newX / 20) * 20;
            newY = Math.round(newY / 20) * 20;

            nodes[draggedNode.id].x = newX;
            nodes[draggedNode.id].y = newY;
            
            draggedNode.style.left = `${newX}px`;
            draggedNode.style.top = `${newY}px`;
            
            updateConnections();
        }

        if (isDrawingConnection) {
            const rect = canvasInner.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) / zoom;
            const mouseY = (e.clientY - rect.top) / zoom;
            tempLine.setAttribute('d', getBezierPath(drawingStartX, drawingStartY, mouseX, mouseY));
        }
    });

    document.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            canvasContainer.style.cursor = 'default';
        }
        if (draggedNode) {
            draggedNode.style.zIndex = "";
            draggedNode = null;
        }
        if (isDrawingConnection) {
            isDrawingConnection = false;
            tempLine.style.display = 'none';
            drawingStartNodeId = null;
        }
    });

    // Zoom Controls
    function setZoom(newZoom, originX = null, originY = null) {
        newZoom = Math.max(0.2, Math.min(newZoom, 3));
        
        if (originX !== null && originY !== null) {
            panX = originX - (originX - panX) * (newZoom / zoom);
            panY = originY - (originY - panY) * (newZoom / zoom);
        } else {
            // Zoom to center
            const rect = canvasContainer.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            panX = centerX - (centerX - panX) * (newZoom / zoom);
            panY = centerY - (centerY - panY) * (newZoom / zoom);
        }
        
        zoom = newZoom;
        zoomLevelText.innerText = `${Math.round(zoom * 100)}%`;
        updateCanvasTransform();
    }

    canvasContainer.addEventListener('wheel', (e) => {
        if(e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const rect = canvasContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        setZoom(e.deltaY > 0 ? zoom * 0.9 : zoom * 1.1, mouseX, mouseY);
    }, { passive: false });

    btnZoomIn.addEventListener('click', () => setZoom(zoom * 1.2));
    btnZoomOut.addEventListener('click', () => setZoom(zoom * 0.8));
    btnZoomFit.addEventListener('click', () => {
        const nodeIds = Object.keys(nodes);
        if (nodeIds.length === 0) return setZoom(1);

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodeIds.forEach(id => {
            const n = nodes[id];
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + 240 > maxX) maxX = n.x + 240; // 240 is approx node width
            if (n.y + 100 > maxY) maxY = n.y + 100;
        });

        const rect = canvasContainer.getBoundingClientRect();
        const padding = 100;
        const scaleX = (rect.width - padding*2) / (maxX - minX);
        const scaleY = (rect.height - padding*2) / (maxY - minY);
        
        const targetZoom = Math.min(scaleX, scaleY, 1); // Cap at 100%
        zoom = targetZoom;
        
        panX = (rect.width / 2) - ((minX + maxX) / 2) * zoom;
        panY = (rect.height / 2) - ((minY + maxY) / 2) * zoom;
        
        zoomLevelText.innerText = `${Math.round(zoom * 100)}%`;
        updateCanvasTransform();
    });

    function updateCanvasTransform() {
        canvasInner.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        canvasContainer.style.backgroundPosition = `${panX}px ${panY}px`;
        canvasContainer.style.backgroundSize = `${20 * zoom}px ${20 * zoom}px`;
    }

    // ==========================================
    // 2. NODE CREATION & INTERACTION
    // ==========================================

    function createNode(type, title, iconClass, colorClass, canvasX, canvasY) {
        // Snap initial creation to grid
        canvasX = Math.round(canvasX / 20) * 20;
        canvasY = Math.round(canvasY / 20) * 20;

        const id = `node-${nodeIdCounter++}`;
        const node = document.createElement('div');
        node.className = 'workflow-node';
        node.id = id;
        node.style.left = `${canvasX}px`;
        node.style.top = `${canvasY}px`;
        
        const tempDiv = document.createElement('div');
        tempDiv.className = colorClass;
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        const computedColor = window.getComputedStyle(tempDiv).backgroundColor;
        document.body.removeChild(tempDiv);
        node.style.borderTopColor = computedColor;

        const hasIn = type !== 'webhook' && type !== 'schedule' && type !== 'cron-trigger' && !type.includes('trigger');
        
        node.innerHTML = `
            <div class="port port-in" style="display: ${hasIn ? 'block' : 'none'}" data-port="in" data-nodeid="${id}"></div>
            <div class="node-header">
                <div class="node-icon-small ${colorClass}"><i class="fa-solid ${iconClass}"></i></div>
                <div class="node-header-text">
                    <h3 id="title-${id}">${title}</h3>
                    <p>Double click to setup</p>
                </div>
            </div>
            <div class="node-content">
                Configure...
            </div>
            <div class="port port-out" data-port="out" data-nodeid="${id}"></div>
        `;

        nodes[id] = { el: node, x: canvasX, y: canvasY, type, title };
        nodesContainer.appendChild(node);

        makeNodeDraggable(node);
        setupPorts(node);
        
        node.addEventListener('dblclick', () => openPanel('settings', nodes[id]));
    }

    function makeNodeDraggable(node) {
        const header = node.querySelector('.node-header');
        header.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            draggedNode = node;
            const rect = node.getBoundingClientRect();
            // Get offset precisely so it doesn't snap abruptly
            nodeOffsetX = (e.clientX - rect.left);
            nodeOffsetY = (e.clientY - rect.top);
            selectElement('node', node);
            node.style.zIndex = 1000; 
        });
        
        node.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            selectElement('node', node);
        });
    }

    // ==========================================
    // 3. CONNECTIONS (WIRES)
    // ==========================================

    function setupPorts(node) {
        const ports = node.querySelectorAll('.port');
        ports.forEach(port => {
            port.addEventListener('mousedown', (e) => {
                e.stopPropagation(); 
                isDrawingConnection = true;
                drawingStartNodeId = port.getAttribute('data-nodeid');
                drawingStartPort = port.getAttribute('data-port');
                
                const rect = port.getBoundingClientRect();
                const innerRect = canvasInner.getBoundingClientRect();
                drawingStartX = (rect.left + rect.width/2 - innerRect.left) / zoom;
                drawingStartY = (rect.top + rect.height/2 - innerRect.top) / zoom;
                
                tempLine.setAttribute('d', `M ${drawingStartX} ${drawingStartY} L ${drawingStartX} ${drawingStartY}`);
                tempLine.style.display = 'block';
            });
            
            port.addEventListener('mouseup', (e) => {
                if (isDrawingConnection) {
                    const targetNodeId = port.getAttribute('data-nodeid');
                    const targetPort = port.getAttribute('data-port');
                    
                    if (targetNodeId !== drawingStartNodeId && drawingStartPort !== targetPort) {
                        const fromId = drawingStartPort === 'out' ? drawingStartNodeId : targetNodeId;
                        const toId = drawingStartPort === 'out' ? targetNodeId : drawingStartNodeId;
                        
                        const exists = connections.find(c => c.fromId === fromId && c.toId === toId);
                        if (!exists) createConnection(fromId, toId);
                    }
                }
            });
        });
    }

    function createConnection(fromId, toId) {
        const pathId = `conn-${Date.now()}`;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute('class', 'connection-line');
        path.setAttribute('id', pathId);
        svgCanvas.appendChild(path);
        
        const connObj = { id: pathId, fromId, toId, pathEl: path };
        connections.push(connObj);
        
        nodes[fromId].el.querySelector('.port-out').classList.add('connected');
        nodes[toId].el.querySelector('.port-in').classList.add('connected');
        
        path.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            selectElement('connection', connObj);
        });

        updateConnections();
    }

    function updateConnections() {
        connections.forEach(conn => {
            const fromNode = nodes[conn.fromId].el;
            const toNode = nodes[conn.toId].el;
            const fromPort = fromNode.querySelector('.port-out');
            const toPort = toNode.querySelector('.port-in');
            const innerRect = canvasInner.getBoundingClientRect();
            
            const p1 = fromPort.getBoundingClientRect();
            const x1 = (p1.left + p1.width/2 - innerRect.left) / zoom;
            const y1 = (p1.top + p1.height/2 - innerRect.top) / zoom;
            
            const p2 = toPort.getBoundingClientRect();
            const x2 = (p2.left + p2.width/2 - innerRect.left) / zoom;
            const y2 = (p2.top + p2.height/2 - innerRect.top) / zoom;
            
            conn.pathEl.setAttribute('d', getBezierPath(x1, y1, x2, y2));
        });
    }

    function getBezierPath(x1, y1, x2, y2) {
        const distance = Math.abs(x2 - x1);
        const curveOffset = Math.max(distance * 0.5, 50); 
        return `M ${x1} ${y1} C ${x1 + curveOffset} ${y1}, ${x2 - curveOffset} ${y2}, ${x2} ${y2}`;
    }

    // ==========================================
    // 4. SELECTION & DELETION
    // ==========================================

    function selectElement(type, obj) {
        clearSelection();
        if (type === 'node') {
            activeNode = obj;
            activeNode.classList.add('selected');
        } else if (type === 'connection') {
            activeConnection = obj;
            activeConnection.pathEl.classList.add('selected');
        }
    }

    function clearSelection() {
        if (activeNode) {
            activeNode.classList.remove('selected');
            activeNode = null;
        }
        if (activeConnection) {
            activeConnection.pathEl.classList.remove('selected');
            activeConnection = null;
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if(document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
            if (activeNode) deleteNode(activeNode.id);
            else if (activeConnection) deleteConnection(activeConnection.id);
        }
    });

    function deleteConnection(connId) {
        const index = connections.findIndex(c => c.id === connId);
        if (index !== -1) {
            const conn = connections[index];
            conn.pathEl.remove();
            
            const fromId = conn.fromId;
            const toId = conn.toId;
            connections.splice(index, 1);
            
            if (!connections.find(c => c.fromId === fromId)) {
                if(nodes[fromId]) nodes[fromId].el.querySelector('.port-out').classList.remove('connected');
            }
            if (!connections.find(c => c.toId === toId)) {
                if(nodes[toId]) nodes[toId].el.querySelector('.port-in').classList.remove('connected');
            }
            activeConnection = null;
        }
    }

    function deleteNode(nodeId) {
        const connsToRemove = connections.filter(c => c.fromId === nodeId || c.toId === nodeId);
        connsToRemove.forEach(c => deleteConnection(c.id));
        nodes[nodeId].el.remove();
        delete nodes[nodeId];
        activeNode = null;
    }

    // ==========================================
    // 5. DRAG & DROP FROM PANELS
    // ==========================================
    
    const leftNodes = document.querySelectorAll('.left-node');
    leftNodes.forEach(node => {
        node.addEventListener('dragstart', (e) => {
            const type = node.getAttribute('data-type');
            const title = node.getAttribute('data-title');
            const iconClass = node.getAttribute('data-icon');
            const colorClass = 'bg-' + (type.includes('hrms') ? 'green' : 'red'); 
            e.dataTransfer.setData('application/json', JSON.stringify({ type, title, iconClass, colorClass }));
        });
    });

    canvasContainer.addEventListener('dragover', (e) => e.preventDefault());
    canvasContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        const payloadStr = e.dataTransfer.getData('application/json');
        if (payloadStr) {
            const data = JSON.parse(payloadStr);
            const innerRect = canvasInner.getBoundingClientRect();
            const x = (e.clientX - innerRect.left - 120) / zoom;
            const y = (e.clientY - innerRect.top - 50) / zoom;
            createNode(data.type, data.title, data.iconClass, data.colorClass, x, y);
        }
    });

    function renderNodeLibrary(filterText = "") {
        panelContent.innerHTML = "";
        hrNodeCategories.forEach(category => {
            const filteredNodes = category.nodes.filter(n => n.toLowerCase().includes(filterText.toLowerCase()));
            if (filteredNodes.length > 0) {
                const catHeader = document.createElement('div');
                catHeader.className = 'node-category';
                catHeader.innerText = category.name;
                panelContent.appendChild(catHeader);
                
                filteredNodes.forEach(nodeName => {
                    const item = document.createElement('div');
                    item.className = 'node-list-item';
                    item.setAttribute('data-type', slugify(nodeName));
                    item.setAttribute('data-title', nodeName);
                    item.setAttribute('data-icon', category.icon);
                    item.innerHTML = `
                        <div class="node-icon ${category.color}"><i class="fa-solid ${category.icon}"></i></div>
                        <div class="node-info">
                            <div class="node-title">${nodeName}</div>
                            <div class="node-desc">${category.name.substring(3)} Operation</div>
                        </div>
                    `;
                    panelContent.appendChild(item);
                });
            }
        });
    }

    const searchInput = panelSearchContainer.querySelector('input');
    searchInput.addEventListener('input', (e) => renderNodeLibrary(e.target.value));

    panelContent.addEventListener('click', (e) => {
        const item = e.target.closest('.node-list-item');
        if (item) {
            const type = item.getAttribute('data-type');
            const title = item.getAttribute('data-title');
            const iconClass = item.getAttribute('data-icon');
            const colorClass = item.querySelector('.node-icon').className.split(' ').find(c => c.startsWith('bg-'));
            
            const rect = canvasContainer.getBoundingClientRect();
            const viewCenterX = rect.width / 2;
            const viewCenterY = rect.height / 2;
            const x = (viewCenterX - panX - 120) / zoom;
            const y = (viewCenterY - panY - 50) / zoom;

            createNode(type, title, iconClass, colorClass, x, y);
            closePanel();
        }
    });

    // ==========================================
    // 6. UI BUTTON ACTIONS & EXECUTION
    // ==========================================

    let activeSettingsNodeId = null;

    function openPanel(mode, nodeData = null) {
        rightPanel.classList.add('open');
        if (mode === 'add') {
            panelTitle.innerText = "Add Node";
            panelSearchContainer.style.display = 'block';
            panelContent.style.display = 'block';
            settingsTemplate.style.display = 'none';
        } else if (mode === 'settings') {
            panelTitle.innerText = "Node Settings";
            panelSearchContainer.style.display = 'none';
            panelContent.style.display = 'none';
            settingsTemplate.style.display = 'block';
            
            document.getElementById('setting-name').value = nodeData.title;
            // Store the node id so we can update it on save
            activeSettingsNodeId = Object.keys(nodes).find(id => nodes[id].title === nodeData.title); 
        }
    }

    function closePanel() { rightPanel.classList.remove('open'); }
    openPanelBtn.addEventListener('click', () => openPanel('add'));
    closePanelBtn.addEventListener('click', closePanel);

    // Save Node Button
    btnSaveNode.addEventListener('click', () => {
        if (activeSettingsNodeId && nodes[activeSettingsNodeId]) {
            const newName = document.getElementById('setting-name').value;
            nodes[activeSettingsNodeId].title = newName;
            document.getElementById(`title-${activeSettingsNodeId}`).innerText = newName;
            closePanel();
            alert('Node settings saved!');
        }
    });

    // Execute Workflow Button
    btnExecute.addEventListener('click', () => {
        // Compile the visual graph into JSON
        const workflowData = {
            nodes: Object.keys(nodes).map(id => ({
                id: id,
                type: nodes[id].type,
                name: nodes[id].title,
                position: [nodes[id].x, nodes[id].y]
            })),
            connections: connections.map(c => ({
                source: c.fromId,
                target: c.toId
            }))
        };
        
        console.log("EXECUTING WORKFLOW: ", workflowData);
        alert(`Workflow execution triggered!\n\nNodes: ${workflowData.nodes.length}\nConnections: ${workflowData.connections.length}\n\n(Check Developer Console for full JSON payload)`);
    });

    // Binding Left Nav and Header Buttons
    function bindNavButtons() {
        btnShare.addEventListener('click', () => alert("Share Link Copied to Clipboard!"));
        
        document.querySelectorAll('.nav-item').forEach(item => {
            if(!item.classList.contains('node-list-item')) {
                item.addEventListener('click', (e) => {
                    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                });
            }
        });

        document.getElementById('create-node-btn').addEventListener('click', () => {
            document.getElementById('custom-node-modal').style.display = 'flex';
        });

        // Close modal
        document.getElementById('close-modal-btn').addEventListener('click', () => {
            document.getElementById('custom-node-modal').style.display = 'none';
        });

        // Save Custom Node
        document.getElementById('save-custom-node-btn').addEventListener('click', () => {
            const name = document.getElementById('custom-node-name').value || 'New Node';
            const icon = document.getElementById('custom-node-icon').value;
            const color = document.getElementById('custom-node-color').value;
            
            const customNodesSection = document.querySelector('.custom-nodes-section');
            const btnCreateNode = document.getElementById('create-node-btn');
            
            const newNodeEl = document.createElement('div');
            newNodeEl.className = 'nav-item node-list-item left-node';
            newNodeEl.setAttribute('draggable', 'true');
            newNodeEl.setAttribute('data-type', 'custom_' + slugify(name));
            newNodeEl.setAttribute('data-title', name);
            newNodeEl.setAttribute('data-icon', icon.replace('fa-', ''));
            
            newNodeEl.innerHTML = `
                <i class="fa-solid ${icon}" style="color: var(--color-${color.replace('bg-', '')});"></i> <span>${name}</span>
            `;
            
            newNodeEl.addEventListener('dragstart', (e) => {
                const payload = JSON.stringify({ 
                    type: 'custom_' + slugify(name), 
                    title: name, 
                    iconClass: icon.replace('fa-', ''), 
                    colorClass: color 
                });
                e.dataTransfer.setData('application/json', payload);
            });

            customNodesSection.insertBefore(newNodeEl, btnCreateNode);
            document.getElementById('custom-node-modal').style.display = 'none';
            alert(`Successfully created custom node: ${name}\nYou can now drag it onto the canvas!`);
            
            // Clear inputs
            document.getElementById('custom-node-name').value = '';
            document.getElementById('custom-node-url').value = '';
        });
    }
});
