import fs from 'fs';
import { distance } from '@turf/distance';
import { motorway_prefix } from "./config.js";
import queryOverpass from '@derhuerst/query-overpass';

function is_number_in_ranges(number, ranges) {
    return ranges.some(([lower_bound, upper_bound]) => lower_bound <= number && number <= upper_bound);
}

function fetch_milestones_for_motorway(motorway) {
    const query = '[out:json][timeout:25];'
    + 'area(id:3600186382)->.searchArea;'
    + '('
    + `  way["highway"="motorway"][name="${motorway_prefix} ${motorway.name}"];`
    + '  >>;'
    + `  way["highway"="construction"]["construction"="motorway"][name="${motorway_prefix} ${motorway.name}"];`
    + '  >>;'
    + ') -> .motorway_nodes;'
    + 'node.motorway_nodes["highway"="milestone"] -> .milestones;'
    + '.milestones out geom;';
    return queryOverpass(query);
}

function preprocess_osm_data(milestones) {
    const to_return = milestones.map(({lat, lon, tags, id}) => ({
        coords: [lat, lon],
        distance: Number(tags.distance),
        osm_id: id,
        suspicious: tags.fixme || tags.note
    }));
    return to_return;
}

function merge_close_milestones(milestones) {
    for(let i = milestones.length - 1; i>0; i--) {
        const current = milestones[i];
        if(current.double) {
            continue;
        }
        const first_occurance_index = milestones.findIndex((potential_match, j) =>
            i != j && potential_match.distance === current.distance);
        if(first_occurance_index != -1) {
            const found = milestones[first_occurance_index];
            const coords1 = current.coords;
            const coords2 = found.coords;
            const distance_between = distance(coords1, coords2, {units: 'meters'});
            if(distance_between > 100) {
                continue;
            }
            found.coords = [
                (coords1[0] + coords2[0]) / 2,
                (coords1[1] + coords2[1]) / 2
            ];
            found.double = true;
            found.osm_id += ';' + current.osm_id;
            milestones.splice(i, 1)[0];
        }
        else {
            milestones[i].double = false;
        }
    }
    return milestones;
}

function validate_milestones(milestones, ranges, are_doubles) {    
    const missing = [];
    const duplicated = [];
    const seen = [];
    
    for(const [start, end] of ranges) {
        for(let i = start; i < end; i++) {
            if(!milestones.find(e => e.distance === i)) {
                missing.push(i);
                continue;
            }

            if(seen.includes(i)) {
                duplicated.push(i);
            }
            else {
                seen.push(i);
            }
        }
    }

    const out_of_range = milestones.map(d => d.distance).filter(distance => !is_number_in_ranges(distance, ranges));
    const single = milestones.filter(ml => are_doubles && !ml.double).map(ml=>ml.distance);
    return {missing, duplicated, out_of_range, single, milestones};
}

async function run() {
    const motorways = JSON.parse(fs.readFileSync('./data.json'));
    const motorways_data = [];
    for(const motorway of motorways) {
        await fetch_milestones_for_motorway(motorway)
        .then(data => preprocess_osm_data(data))
        .then(data => data.filter(marker => !Number.isNaN(marker.distance)))
        .then(data => {
            motorway.milestones = data;
            merge_close_milestones(motorway.milestones);
            const possibly_invalid_milestones = validate_milestones(motorway.milestones, motorway.ranges);
            console.log(motorway.name, "missing ", possibly_invalid_milestones.missing, "dupes", possibly_invalid_milestones.duplicated, "invalid", possibly_invalid_milestones.out_of_range, "single", possibly_invalid_milestones.single);
            motorways_data.push({
                name: motorway.name,
                ranges: motorway.ranges,
                warnings: possibly_invalid_milestones
            });
        });
    }
    console.log(`Writing to output_data.json`);
    fs.writeFileSync(`output.json`, JSON.stringify({date: new Date().toISOString(), data: motorways_data}));

}

run();