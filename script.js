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

	/* Map */
	// Create map
	var map = new L.Map('map');
	map.on('moveend', function(e) {
		// TODO: Enable autoload
		//loadFeatures();
	});

	// Add OSM layer
	var osmUrl = 'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	var osmAttrib= 'Map data © <a href="http://openstreetmap.org">OpenStreetMap</a> contributors';
	var osm = new L.TileLayer(osmUrl, {minZoom: 1, maxZoom: 19, attribution: osmAttrib});
	map.addLayer(osm);

	// Add black overlay
	var overlay = L.tileLayer('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQAAAAB0CZXLAAAAH0lEQVR4Ae3BAQEAAAgCoP6v7kYpMAAAAAAAAAAAzy0hAAABhF/yqwAAAABJRU5ErkJggg==', {opacity: 0.5, minZoom: 1, maxZoom: 19});
	map.addLayer(overlay);

	// Add line groups
	var groups = [];
	for(var i = 0; i < 3; i++) {
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

		// Order the groups z-index (bringToFront() doesn't work here for some reason)
		for(var i = 0; i < groups.length; i++) {
			map.removeLayer(groups[i]);
			map.addLayer(groups[i]);
		}
	}

	// Splits a way at a given node and shortens it. All ways start at the via node.
	function splitWay(way, pos) {
		var wayParts = [];
		if(pos != 0) {
			// Left split
			var wayPart = getWayPart(way, 0, pos + 1, true);
			wayParts.push(wayPart);
		}
		if(pos != way.nodes.length - 1) {
			// Right split
			var wayPart = getWayPart(way, pos, way.nodes.length, false);
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
		return { id: way.id, nodes: wayNodes2 };
	}

	function drawVia(via) {
		// Draw ways
		$.each(via.ways, function(i, way) {
			// Count restrictions of which it is part of
			var isNo = false;
			var isOnly = false;
			var num = 0;
			for(var i = 0; i < via.restrictions.length; i++) {
				var restriction = via.restrictions[i];
				for(var j = 0; j < restriction.members.length; j++) {
					if(restriction.members[j].way_ref == way.id) {
						if(restriction.type.startsWith('no_')) {
							isNo = true;
						}
						else if(restriction.type.startsWith('only_')) {
							isOnly = true;
						}
						num++;
						break;
					}
				}
			}

			// Set line properties
			var options = {
				opacity: 1,
				clickable: false
			};

			if(num == 0) {
				options.color = 'white';
				options.weight = 2;
			} else {
				options.weight = 3;
				if(isOnly) {
					options.color = '#0f0';
				} else { // if(isNo)
					options.color = 'red';
				}
			}

			// Draw line
			var polyline = L.polyline(way.nodes, options);
			if(num == 0) {
				groups[0].addLayer(polyline);
			} else {
				groups[1].addLayer(polyline);
			}

			// Draw dashed line
			if(isOnly && isNo) {
				options.color = 'red';
				options.dashArray = [5, 5];
				options.lineCap = 'butt';
				var polyline = L.polyline(way.nodes, options);
				groups[1].addLayer(polyline);
			}
		});

		// Draw via node
		groups[2].addLayer(L.circleMarker(via.via, {
			fillColor: 'black',
			weight: 0,
			fillOpacity: 0.8,
			clickable: false
		}).setRadius(3));
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
