/* Ignores:
	- Restrcitons where the "via" member is a way
	- Vehicle types, eg. "restriction:hgv"
*/

$(document).ready(function() {
	var minLoadingZoom = 15;

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

	/* Spinner */
	var spinner = new Spinner({
		color:'#fff',
		lines: 12,
		width: 3,
		radius: 7
	});

	function startSpinner() {
		spinner.spin(document.getElementById('spinner'));
	}

	function stopSpinner() {
		spinner.stop();
	}

	/* Map */
	// Create map
	var options = getOptions();
	var map = new L.Map('map', options);
	map.on('moveend', function() {
		updateMap();
	});
	updateMap();

	// Add locate control
	L.control.locate({
		drawCircle: false,
		keepCurrentZoomLevel: true
	}).addTo(map);

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
	var markerGroup = L.markerClusterGroup({
		maxClusterRadius: 20
	}).addTo(map);
	groups.push(markerGroup);

	// Get map options for settings the default center and zoom
	function getOptions() {
		// Check for permalink
		var url = window.location.href;
		var pos = url.lastIndexOf('#');
		if(pos != -1) {
			url = url.substring(pos + 1);
			var parts = url.split('/');
			if(parts.length == 3) {
				return {
					center: [parts[1], parts[2]],
					zoom: parts[0]
				};
			}
		}

		// Restore location cookie
		var options = Cookies.getJSON('location');
		if(options != undefined) {
			return options;
		}

		// Default options
		return {
			center: [52.45, 13.35],
			zoom: 14
		};
	}

	function updateMap() {
		// Update address bar for permalink
		var center = map.getCenter();
		var decimals = 5;
		var locStr = '#' + map.getZoom() + '/' + center.lat.toFixed(decimals) + '/' + center.lng.toFixed(decimals);
		window.history.replaceState({}, '', locStr);

		// Update zoom hint
		if(map.getZoom() < minLoadingZoom) {
			$('.zoom-hint').show();
		} else {
			$('.zoom-hint').hide();
		}

		// Load data
		loadFeatures();

		// Update location cookie
		Cookies.set('location', {
			center: map.getCenter(),
			zoom: map.getZoom()
		}, {
			expires: 365
		});
	}

	// Starte Overpass request
	var loadedBbox, loadingBbox;
	var ajax;
	function loadFeatures() {
		// Check zoom
		if(map.getZoom() < minLoadingZoom) {
			return;
		}

		// Increase bbox so that we don't have to reload on small drags
		var bbox = map.getBounds();
		var bbox2 = bbox.pad(0.2);

		// Check if already loaded
		if(loadedBbox != undefined) {
			if(loadedBbox.contains(bbox)) {
				cancelLoading();
				return;
			}
		}

		// Check if loading
		if(loadingBbox != undefined && loadingBbox) {
			if(loadingBbox.contains(bbox)) {
				return;
			} else {
				cancelLoading();
			}
		}

		// Load
		startSpinner();
		loadingBbox = bbox2;
		var coords = bbox2.getSouthEast().lat+','+bbox2.getNorthWest().lng+','+bbox2.getNorthWest().lat+','+bbox2.getSouthEast().lng;
		var request = '[out:json][timeout:25];(relation["type"="restriction"](' + coords + ');node(r);way(bn)["highway"]["highway"~"^motorway|^trunk|^primary|^secondary|^tertiary|living_street|unclassified|residential|service|road"];);out body;>;out body;';
		console.log(request);
		var url = 'http://overpass.osm.rambler.ru/cgi/interpreter?data=' + encodeURIComponent(request);

		ajax = $.ajax({
			url: url,
			type: 'GET',
			crossDomain: true,
			success: parseOSM
		});
	}

	function cancelLoading() {
		stopSpinner();
		if(ajax != undefined && ajax) {
			ajax.abort();
			ajax = null;
		}
		loadingBbox = null;
	}

	// Parse Overpass result
	var nodes, ways, relations;
	function parseOSM(data) {
		console.log('Success');
		stopSpinner();

		// Update bboxes
		ajax = null;
		loadedBbox = loadingBbox;
		loadingBbox = null;

		nodes = [];
		ways = [];
		relations = [];

		$.each(data.elements, function(none, elem) {
			var id = elem.id;
			switch(elem.type) {
				case 'node':
					nodes[id] = elem;
					break;
				case 'way':
					ways[id] = elem;
					break;
				case 'relation':
					relations[id] = elem;
					break;
			}
		});

		// Clear layers
		$.each(groups, function(none, group) {
			group.clearLayers();
		});

		// Iterate restrictions
		var vias = [];
		$.each(getElemList(relations, false), function(none, rel) {
			var via = [];
			var members = [];
			var nFrom = 0;
			var nTo = 0;
			var nUnknown = 0;

			// Get roles
			for(var i = 0; i < rel.members.length; i++) {
				var member = rel.members[i];
				if(member.role == 'via') {
					if(member.type == 'node') {
						via.push(nodes[member.ref]);
					} else {
						// We don't handle via ways/relations
						return;
					}
				} else if(member.type == 'way' && member.role == 'from') {
					nFrom++;
					members.push({ type: 'from', way_ref: member.ref });
				} else if(member.type == 'way' && member.role == 'to') {
					nTo++;
					members.push({ type: 'to', way_ref: member.ref });
				} else if(member.type == 'node' && member.role == 'location_hint') {
				} else {
					nUnknown++;
				}
    		}

			/* Check via */
			// No via found, we can't show an error, because we have no coordinate and there can be a "via"-way
			if(via.length == 0) {
				return;
			}

			// Multiple vias, found but only 1 node is allowed
			if(via.length > 1) {
				$.each(via, function(none, tempVia) {
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
			var access = type.split('_')[0]; // no/only

			// Check if restriction type is valid
			if($.inArray(type, restrictionTypes) == -1) {
				// Because only the start is relavant ("no_"/"only_") we will continue if one of them is given
				var warning = false;
				if(access == 'no' || access == 'only') {
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
			if(nFrom > 1 && type != 'no_entry') {
				showError([via.lat, via.lon], rel, 'More than 1 "from"-members, but restriction is not "no_entry"', true);
			}
			if(nTo > 1 && type != 'no_entry') {
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
				id: rel.id,
				type: type,
				access: access,
				members: members,
				nTo: nTo,
				nFrom: nFrom
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
		$.each(getElemList(ways), function(none, way) {
			if(way.tags != undefined && way.tags.highway != undefined) {
				$.each(way.nodes, function(i, node_ref) {
					if(vias[node_ref] != undefined) {
						var splitWays = splitWay(way, i);
						vias[node_ref].ways = vias[node_ref].ways.concat(splitWays);
					}
				});
			}
		});

		// Add oneway to restriction members
		$.each(getElemList(vias, true), function(none, node_ref) {
			var via = vias[node_ref];
			$.each(via.restrictions, function(i, rel) {
				$.each(rel.members, function(j, member) {
					// Get way
					for(var k = 0; k < via.ways.length; k++) {
						var way = via.ways[k];
						if(member.way_ref == way.id) {
							vias[node_ref].restrictions[i].members[j].oneway = way.oneway;
							break;
						}
					}
				});
			});
		});

		// Draw vias
		$.each(getElemList(vias), function(none, via) {
			drawVia(via);
		});

		// Check vias
		$.each(getElemList(vias), function(none, via) {
			checkVia(via);
		});

        // Order layers
        orderLayers();
	}

    // Order the groups z-index (bringToFront() doesn't work here for some reason)
    function orderLayers() {
		$.each(groups, function(none, group) {
			map.removeLayer(group);
			map.addLayer(group);
		});
    }

	// Splits a way at a given node and shortens it. All ways start at the via node.
	function splitWay(way, pos) {
		// Get oneway
		var oneway = 0;
		if(way.tags.oneway != undefined) {
			switch(way.tags.oneway) {
				case 'yes':
				case '1':
					oneway = 1;
					break;
				case '-1':
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
		$.each(nodeRefs, function(none, node_ref) {
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
		$.each(via.ways, function(none, way) {
			// Get restrictions of which it is part of
			var isNo = false;
			var isOnly = false;
            var roles = [];
			$.each(getRestrictionAssocs(way.id, via.restrictions), function(none, assoc) {
                // Restriction type
				var access = assoc.restriction.access;
				if(access == 'no') {
					isNo = true;
				} else if(access == 'only') {
					isOnly = true;
				}

                // Add to roles
                roles.push({
                    access: access,
                    role: assoc.member.type
                });
			});

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
            $.each(roles, function(none, role) {
                var color = role.access == 'only' ? colors.only : colors.no;
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

	function getRestrictionAssocs(way_ref, restrictions) {
		var assocs = [];
		$.each(restrictions, function(none, restriction) {
			$.each(restriction.members, function(none, member) {
				if(member.way_ref == way_ref) {
					assocs.push({
						restriction: restriction,
						member: member
					});
				}
			});
		});
		return assocs;
	}

    function addArrows(polyline, color, side, direction, layer, weight) {
		// Calculate arrow size based on zoom level
		var zoomFactor = Math.pow(2, map.getZoom() - 14);
        var decorator = L.polylineDecorator(polyline, {
            patterns: [{
                offset: zoomFactor,
                endOffset: 0,
                repeat: zoomFactor / 4 * 3,
                symbol: L.Symbol.arrowHead({
					pixelSize: zoomFactor / 2,
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

	function checkVia(via) {
		// Check wrong direction of to/from members
		var isValid = true;
		$.each(via.restrictions, function(none, rel) {
			$.each(rel.members, function(none, member) {
				var type = member.type
				var way_ref = member.way_ref;

				// Check direction
				if((type == 'to' && member.oneway == -1) ||
					(type == 'from' && member.oneway == 1)
				) {
					showError(via.via, relations[rel.id], 'The "' + type + '"-member is a one-way street that goes in the wrong direction', false);
					isValid = false;
				}
			});
		});
		if(!isValid) {
			return;
		}

		/* Check for unnecessary restrictions */
		// There is no need for a necessary check on "No"-restrictions
		// Get accessible ways
		var accessibles = [];
		$.each(via.ways, function(i, way) {
			if(way.oneway != -1) {
				accessibles.push({
					way_ref: way.id,
					access: false,
					index: i
				});
			}
		});

		$.each(via.restrictions, function(none, rel) {
			// If there is no oneway-from we reduce accessible ways
			var nAccess = accessibles.length - 1;
			for(var i = 0; i < rel.members.length; i++) {
				var member = rel.members[i];
				if(member.type == 'from' && member.oneway == -1) {
					nAccess++;
					break;
				}
			};

			if(rel.access == 'only' && nAccess == rel.nTo) {
				showError(via.via, relations[rel.id], 'Unnecessary restriction: There is no other turn possibility', true);
			}
		});

		/* Check for blocking restrictions */
		// If there is at least 1 incoming way that is not a "from"-member in a restriction, all other ways are accessible
		$.each(via.ways, function(index, way) {
			if(way.oneway != 1) {
				var isFromMember = false;
				var assocs = getRestrictionAssocs(way.id, via.restrictions);
				for(var i = 0; i < assocs.length; i++) {
					if(assocs[i].member.type == 'from') {
						isFromMember = true;
						break;
					}
				}

				// Mark all other ways as accessible
				if(!isFromMember) {
					$.each(accessibles, function(i, acc) {
						// We can't use way id here as the way could be splitted
						if(acc.index != index) {
							accessibles[i].access = true;
						}
					});
				}
			}
		});

		// Go through all restrictions and mark ways that are accessible
		$.each(via.restrictions, function(none, rel) {
			// Get to-members
			var toMembers = [];
			$.each(rel.members, function(none, member) {
				if(member.type == 'to') {
					toMembers[member.way_ref] = true;
				}
			});

			// Update accessibles
			$.each(accessibles, function(i, acc) {
				if((toMembers[acc.way_ref] != undefined && rel.access == 'only') ||
					(toMembers[acc.way_ref] == undefined && rel.access == 'no')) {
					accessibles[i].access = true;
				}
			});
		});

		// Check if there are inaccessible ways
		for(var i = 0; i < accessibles.length; i++) {
			if(!accessibles[i].access) {
				showError(via.via, via.via, 'The restrictions at this node make a street inaccessible. Consider using "oneway" or "access=no" instead of restrictions.', false);
				return;
			}
		}
	}

	function showError(latlon, elem, msg, warning) {
		// Make link
		var url = '';
		var type = '';
		switch(elem.type) {
			case 'node':
				type = 'Node';
				url = 'http://www.openstreetmap.org/node/' + elem.id;
				break;
			case 'relation':
				type = 'Relation';
				url = 'http://www.openstreetmap.org/relation/' + elem.id;
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
