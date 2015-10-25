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

	// Add marker group
	var group = L.markerClusterGroup().addTo(map);
	map.setView(new L.LatLng(52.45, 13.35), 14); // TODO: Detect user location

	// Trigger loading
	$('#load').click(function() {
		loadFeatures();
	});

	// Starte Overpass request
	function loadFeatures() {
		var coords = map.getBounds();
		var bbox = +coords.getSouthEast().lat+','+coords.getNorthWest().lng+','+coords.getNorthWest().lat+','+coords.getSouthEast().lng;
		var request = '[out:json][timeout:25];(relation["type"="restriction"](' + bbox + ');node(r);way(bn)["highway"]["highway"~"^motorway|^trunk|^primary|^secondary|^tertiary|living_street|unclassified|residential|service|road"];);out body;>;out skel qt;';
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
	function parseOSM(data) {
		console.log("Success");

		// Collect elements
		var nodes = [];
		var ways = [];
		var relations = [];
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
		group.clearLayers();

		// Iterate restrictions
		var vias = [];
		$.each(getElemList(relations, false), function(i, rel) {
			var via = [];
			var from = [];
			var to = [];
			var unknown = 0;

			// Get roles
    		$.each(rel.members, function(i, member) {
				if(member.type == "node" && member.role == "via") {
					via.push(nodes[member.ref]);
				} else if(member.type == "way" && member.role == "from") {
					from.push(ways[member.ref]);
				} else if(member.type == "way" && member.role == "to") {
					to.push(ways[member.ref]);
				} else if(member.type == "node" && member.role == "location_hint") {
				} else {
					unknown++;
				}
    		});

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
			if(from.length == 0) {
				showError([via.lat, via.lon], rel, 'No "from"-members', false);
				return;
			}
			if(to.length == 0) {
				showError([via.lat, via.lon], rel, 'No "to"-members', false);
				return;
			}

			// Multiple members (no return here as multiple types can be handled)
			if(from.length > 1 && type != "no_entry") {
				showError([via.lat, via.lon], rel, 'More than 1 "from"-members, but restriction is not "no_entry"', true);
			}
			if(to.length > 1 && type != "no_entry") {
				showError([via.lat, via.lon], rel, 'More than 1 "to"-members, but restriction is not "no_exit"', true);
			}

			// Unnecessary members
			if(unknown > 0) {
				showError([via.lat, via.lon], rel, 'There are ' + unknown + ' unnecessary relation members', true);
			}

			/* Check if ways are connected to via node */
			var members = [].concat(from).concat(to);
			for(var i = 0; i < members.length; i++) {
				member = members[i];
				if(via.id != member.nodes[0] && via.id != member.nodes[member.nodes.length - 1]) {
					showError([via.lat, via.lon], rel, 'There are from/to-members that aren\'t connected to the via node', false);
					return;
				}
			};
		});
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
		var color = warning ? '#d70' : '#a00';
		var marker = L.circleMarker(latlon, {
			fillOpacity: 0.7,
			fillColor: fillColor,
			color: color
		}).setRadius(7).bindPopup(msg, {
			autoPan: false,
			offset: [0, -5]
		});
		group.addLayer(marker);
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
