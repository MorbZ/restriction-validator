/* Ignores:
	- Restrcitons where the "via" member is a way
	- Vehicle types, eg. "restriction:hgv"
*/

$(document).ready(function() {
	// Restriction types
	var restrictionTypes = [
		'no_right_turn',
		'no_left_turn',
		'no_u_turn',
		'no_straight_on',
		'only_right_turn',
		'only_left_turn',
		'only_straight_on',
		'no_entry',
		'no_exit'
	];

	// Colors
	var colors = {
		normal: 'white',
		only: '#0f0',
		no: 'red'
	};

	/* Map */
	// Create map
	var map = new L.Map('map');
	map.on('moveend', function(e) {
		// TODO: Enable autoload
        orderLayers()
	});

	// Add OSM layer
	var osmUrl = 'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	var osmAttrib= 'Map data © <a href="http://openstreetmap.org">OpenStreetMap</a> contributors';
	var osm = new L.TileLayer(osmUrl, {minZoom: 1, maxZoom: 19, attribution: osmAttrib});
	map.addLayer(osm);

	// Add black overlay
	var overlay = L.tileLayer('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQAAAAB0CZXLAAAAH0lEQVR4Ae3BAQEAAAgCoP6v7kYpMAAAAAAAAAAAzy0hAAABhF/yqwAAAABJRU5ErkJggg==', {opacity: 0.5, minZoom: 1, maxZoom: 19});
	map.addLayer(overlay);

	/* Add line groups
	0=Oneway arrows
	1=Restriction arrows
	2=Default Line
	3=Restriction Line/dashed line
	4=Via node */
	var groups = [];
	for(var i = 0; i < 5; i++) {
        groups.push(L.layerGroup().addTo(map));
	}

	// Add marker group
	var markerGroup = L.markerClusterGroup().addTo(map);
	groups.push(markerGroup);
	map.setView(new L.LatLng(52.45, 13.35), 14); // TODO: Detect user location

	// Trigger loading
	$('#load').click(function() {
		loadFeatures();
	});

	// Starte Overpass request
	function loadFeatures() {
		var coords = map.getBounds();
		var bbox = +coords.getSouthEast().lat+','+coords.getNorthWest().lng+','+coords.getNorthWest().lat+','+coords.getSouthEast().lng;
		var request = '[out:json][timeout:25];(relation["type"="restriction"](' + bbox + ');node(r);way(bn)["highway"]["highway"~"^motorway|^trunk|^primary|^secondary|^tertiary|living_street|unclassified|residential|service|road"];);out body;>;out body;';
		console.log(request);
		var url = 'http://overpass-api.de/api/interpreter?data=' + encodeURIComponent(request);

		$.ajax({
			url: url,
			type: 'GET',
			crossDomain: true,
			success: parseOSM
		});
	}

	// Parse Overpass result
	var nodes, ways, relations;
	function parseOSM(data) {
		console.log("Success");

		nodes = [];
		ways = [];
		relations = [];

		$.each(data.elements, function(i, elem) {
			var id = elem.id;
			switch(elem.type) {
				case "node":
					nodes[id] = elem;
					break;
				case "way":
					ways[id] = elem;
					break;
				case "relation":
					relations[id] = elem;
					break;
			}
		});

		// Clear layers
		for(var i = 0; i < groups.length; i++) {
			groups[i].clearLayers();
		}

		// Iterate restrictions
		var vias = [];
		$.each(getElemList(relations, false), function(i, rel) {
			var via = [];
			var members = [];
			var nFrom = 0;
			var nTo = 0;
			var nUnknown = 0;

			// Get roles
			for(var i = 0; i < rel.members.length; i++) {
				member = rel.members[i];
				if(member.role == "via") {
					if(member.type == "node") {
						via.push(nodes[member.ref]);
					} else {
						// We don't handle via ways/relations
						return;
					}
				} else if(member.type == "way" && member.role == "from") {
					nFrom++;
					members.push({ type: "from", way_ref: member.ref });
				} else if(member.type == "way" && member.role == "to") {
					nTo++;
					members.push({ type: "to", way_ref: member.ref });
				} else if(member.type == "node" && member.role == "location_hint") {
				} else {
					nUnknown++;
				}
    		};

			/* Check via */
			// No via found, we can't show an error, because we have no coordinate and there can be a "via"-way
			if(via.length == 0) {
				return;
			}

			// Multiple vias, found but only 1 node is allowed
			if(via.length > 1) {
				$.each(via, function(i, tempVia) {
					showError([tempVia.lat, tempVia.lon], rel, 'There are multiple "via"-nodes', false);
				});
				return;
			}
			via = via[0];

			/* Check restriction type */
			// Check if tag exists
			if(rel.tags.restriction == undefined) {
				// If there are vehicle restrictions we won't show an error, but we don't handle them
				var tags = getElemList(rel.tags, true);
				for(var i = 0; i < tags.length; i++) {
					if(tags[i].startsWith('restriction:')) {
						return;
					}
				};
				showError([via.lat, via.lon], rel, 'There is no "restriction"-tag', false);
				return;
			}
			var type = rel.tags.restriction;

			// Check if restriction type is valid
			if($.inArray(type, restrictionTypes) == -1) {
				// Because only the start is relavant ("no_"/"only_") we will continue if one of them is given
				var warning = false;
				if(type.startsWith('no_') || type.startsWith('only_')) {
					warning = true;
				}

				showError([via.lat, via.lon], rel, 'Unknown restriction "' + escapeHTML(type) + '"', warning);
				if(!warning) {
					return;
				}
			}

			/* Check number of member types */
			// No members
			if(nFrom == 0) {
				showError([via.lat, via.lon], rel, 'No "from"-members', false);
				return;
			}
			if(nTo == 0) {
				showError([via.lat, via.lon], rel, 'No "to"-members', false);
				return;
			}

			// Multiple members (no return here as multiple types can be handled)
			if(nFrom > 1 && type != "no_entry") {
				showError([via.lat, via.lon], rel, 'More than 1 "from"-members, but restriction is not "no_entry"', true);
			}
			if(nTo > 1 && type != "no_entry") {
				showError([via.lat, via.lon], rel, 'More than 1 "to"-members, but restriction is not "no_exit"', true);
			}

			// Unnecessary members
			if(nUnknown > 0) {
				showError([via.lat, via.lon], rel, 'There are ' + nUnknown + ' unnecessary relation members', true);
			}

			/* Check if ways are connected to via node */
			for(var i = 0; i < members.length; i++) {
				var way = ways[members[i].way_ref];
				if(via.id != way.nodes[0] && via.id != way.nodes[way.nodes.length - 1]) {
					showError([via.lat, via.lon], rel, 'There are from/to-members that aren\'t connected to the via node', false);
					return;
				}
			};

			// Add to vias
			var restriction = {
				type: type,
				members: members
			};
			if(vias[via.id] == undefined) {
				vias[via.id] = {
					via: via,
					restrictions: [ restriction ],
					ways: []
				};
			} else {
				vias[via.id].restrictions.push(restriction);
			}
		});

		// Add connected ways to via
		$.each(getElemList(ways), function(i, way) {
			if(way.tags != undefined && way.tags.highway != undefined) {
				for(var i = 0; i < way.nodes.length; i++) {
					var node_ref = way.nodes[i];
					if(vias[node_ref] != undefined) {
						var splitWays = splitWay(way, i);
						vias[node_ref].ways = vias[node_ref].ways.concat(splitWays);
					}
				};
			}
		});

		// Draw restrictions
		$.each(getElemList(vias), function(i, via) {
			drawVia(via);
		});

        // Order layers
        orderLayers();
	}

    // Order the groups z-index (bringToFront() doesn't work here for some reason)
    function orderLayers() {
		for(var i = 0; i < groups.length; i++) {
			map.removeLayer(groups[i]);
			if(!(map.getZoom() < 17 && i <= 1)) { // Don't show arrows at low zoom levels
				map.addLayer(groups[i]);
			}
		}
    }

	// Splits a way at a given node and shortens it. All ways start at the via node.
	function splitWay(way, pos) {
        // Get oneway
        var oneway = 0;
        if(way.tags.oneway != undefined) {
            switch(way.tags.oneway) {
                case "yes":
                case "1":
                    oneway = 1;
                    break;
                case "-1":
                    oneway = -1;
                    break;
            }
        }

		var wayParts = [];
		if(pos != 0) {
			// Left split
            var wayNodes = getWayPart(way, 0, pos + 1, true);
            var tempOneway = oneway == 0 ? 0 : -oneway;
			var wayPart = { id: way.id, nodes: wayNodes, oneway: tempOneway };
			wayParts.push(wayPart);
		}
		if(pos != way.nodes.length - 1) {
			// Right split
			var wayNodes = getWayPart(way, pos, way.nodes.length, false);
            var wayPart = { id: way.id, nodes: wayNodes, oneway: oneway };
			wayParts.push(wayPart);
		}
		return wayParts;
	}

	// Slices a part of a way, shortens it, and adds just the node positions
	function getWayPart(way, start, end, reverse) {
		// Slice and add node positions
		var nodeRefs = way.nodes.slice(start, end);
		var wayNodes = [];
		$.each(nodeRefs, function(i, node_ref) {
			var node = nodes[node_ref];
			wayNodes.push({
				lat: node.lat,
				lon: node.lon
			});
		});

		// Reverse nodes to let them start from the via node
		if(reverse) {
			wayNodes.reverse();
		}

		// Shorten way
		var wayNodes2 = [];
		var maxLen = 45; // meters
		var len = 0;
		for(var i = 0; i < wayNodes.length; i++) {
			var node = wayNodes[i];
			if(i == 0) {
				wayNodes2.push(node);
			} else {
				// Get distance
				var lastNode = wayNodes[i - 1];
				var dist = L.latLng(lastNode).distanceTo(node);
				if(len + dist < maxLen) {
					wayNodes2.push(node);
					len += dist;
				} else {
					// Split the edge
					var factor = (maxLen - len) / dist;
					var newLat = lastNode.lat + ((node.lat - lastNode.lat) * factor);
					var newLon = lastNode.lon + ((node.lon - lastNode.lon) * factor);
					wayNodes2.push([newLat, newLon]);
					break;
				}
			}
		}
		return wayNodes2;
	}

	function drawVia(via) {
		// Draw ways
		$.each(via.ways, function(i, way) {
			// Get restrictions of which it is part of
			var isNo = false;
			var isOnly = false;
            var roles = [];
			for(var i = 0; i < via.restrictions.length; i++) {
				var restriction = via.restrictions[i];
				for(var j = 0; j < restriction.members.length; j++) {
					if(restriction.members[j].way_ref == way.id) {
                        // Restriction type
                        var type = restriction.type.split('_')[0];
						if(type == 'no') {
							isNo = true;
						} else if(type == 'only') {
							isOnly = true;
						}

                        // Add to roles
                        roles.push({
                            type: type,
                            role: restriction.members[j].type
                        });
						break;
					}
				}
			}

			// Set line properties
			var options = {
				opacity: 1,
				clickable: false
			};

			if(roles.length == 0) {
				options.color = colors.normal;
				options.weight = 2;
			} else {
				options.weight = 3;
				if(isOnly) {
					options.color = colors.only;
				} else { // if(isNo)
					options.color = colors.no;
				}
			}

			// Draw line
			var groupId = roles.length == 0 ? 2 : 3;
			var polyline = L.polyline(way.nodes, options);
			groups[groupId].addLayer(polyline);

			// Add oneway arrows
			if(way.oneway != 0) {
                var direction = way.oneway == 1 ? 'forward' : 'backward';
                addArrows(polyline, colors.normal, 'both', direction, 0, 1.5);
			}

            // Add resctriction arrows
            $.each(roles, function(i, role) {
                var color = role.type == 'only' ? colors.only : colors.no;
                var direction = role.role == 'to' ? 'forward' : 'backward';
                var side = way.oneway == 0 ? 'right' : 'both';
                addArrows(polyline, color, side, direction, 1, 2.5);
            });

			// Draw dashed line
			if(isOnly && isNo) {
				options.color = colors.no;
				options.dashArray = [5, 5];
				options.lineCap = 'butt';
				var polyline = L.polyline(way.nodes, options);
				groups[3].addLayer(polyline);
			}
		});

		// Draw via node
		groups[4].addLayer(L.circleMarker(via.via, {
			fillColor: 'black',
			weight: 0,
			fillOpacity: 0.8,
			clickable: false
		}).setRadius(3));
	}

    function addArrows(polyline, color, side, direction, layer, weight) {
        var decorator = L.polylineDecorator(polyline, {
            patterns: [{
                offset: 10,
                endOffset: 0,
                repeat: 10,
                symbol: L.Symbol.arrowHead({
					pixelSize: 10,
                    side: side,
                    direction: direction,
                    pathOptions: {
                        weight: weight,
            			fillOpacity: 0,
            			opacity: 1,
            			color: color
                    }
                }),
            }]
        });
        groups[layer].addLayer(decorator);
    }

	function showError(latlon, elem, msg, warning) {
		// Make link
		var url = '';
		var type = '';
		switch(elem.type) {
			case "relation":
				type = "Relation";
				url = "http://www.openstreetmap.org/relation/" + elem.id;
				break;
		}

		// Make message
		msg = '<b>' + (warning ? 'Warning' : 'Error') + '</b>: ' + msg;
		msg += '<br>' + type + ' <a href="' + url + '" target="_blank">' + elem.id + '</a>';
		console.log(msg);

		// Add marker
		var fillColor = warning ? 'orange' : 'red';
		var marker = L.circleMarker(latlon, {
			fillOpacity: 1,
			opacity: 1,
			fillColor: fillColor,
			color: 'white'
		}).setRadius(7).bindPopup(msg, {
			autoPan: false,
			offset: [0, -5]
		});
		markerGroup.addLayer(marker);
	}

	/* Util */
	// Returns all key/values of the given object
	function getElemList(elems, keysOnly) {
		var list = [];
		for(var property in elems) {
			if(elems.hasOwnProperty(property)) {
				if(keysOnly) {
					list.push(property);
				} else {
					list.push(elems[property]);
				}
			}
		}
		return list;
	}

	function escapeHTML(str) {
    	return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
	}
});
