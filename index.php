<html>
	<head>
		<title>Restrictions</title>
		<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
		<link rel="stylesheet" href="lib/Font-Awesome/css/font-awesome.min.css">
		<link rel="stylesheet" href="lib/leaflet-0.7.5/leaflet.css" />
		<link rel="stylesheet" href="lib/leaflet-locatecontrol/dist/L.Control.Locate.min.css" />
		<link rel="stylesheet" href="styles.css" />
		<script src="lib/jquery-1.11.1.min.js"></script>
		<script src="lib/js.cookie-2.0.4.min.js"></script>
		<script src="lib/spin.js/spin.min.js"></script>
		<script src="lib/leaflet-0.7.5/leaflet.js"></script>
		<script src="lib/Leaflet.markercluster/dist/leaflet.markercluster-src.js"></script>
		<script src="lib/Leaflet.PolylineDecorator/leaflet.polylineDecorator.js"></script>
		<script src="lib/leaflet-locatecontrol/dist/L.Control.Locate.min.js"></script>
	</head>
	<body>
		<div class="header">
			<span class="title">OSM Restriction Validator</span>
			<div class="menu">
				<a href="https://github.com/MorbZ/restriction-validator" target="_blank">Github</a>
			</div>
		</div>
		<div class="map-container">
			<div class="map" id="map"></div>
			<div class="zoom-hint">
				<div>Please zoom in to load data</div>
			</div>
			<div class="spinner" id="spinner"></div>
		</div>
		<script src="script.js"></script>
	</body>
</html>
