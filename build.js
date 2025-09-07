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
    const to_return = milestones.map(milestone => ({
        coords: [milestone.lat, milestone.lon],
        distance: Number(milestone.tags.distance),
        osm_id: milestone.id,
        suspicious: milestone.tags.fixme || milestone.tags.note
    }));
    return to_return;
}

function merge_close_milestones(milestones) {
    for(let i = milestones.length - 1; i>0; i--) {
        let current = milestones[i];
        if(current.double) {
            continue;
        }
        let first_occurance_index = milestones.findIndex((poteintial_match, i2) => i!=i2 && poteintial_match.distance === current.distance);
        if(first_occurance_index != -1) {
            const coords1 = current.coords;
            const coords2 = milestones[first_occurance_index].coords;
            const distance_between = distance(coords1, coords2, {units: 'meters'});
            if(distance_between > 100) {
                continue;
            }
            let removed = milestones.splice(i, 1)[0];
            milestones[first_occurance_index].coords = [
                (milestones[first_occurance_index].coords[0] + removed.coords[0])/2,
                (milestones[first_occurance_index].coords[1] + removed.coords[1])/2
            ];
            milestones[first_occurance_index].double = true;
            milestones[first_occurance_index].osm_id += ';' + removed.osm_id;
        }
        else {
            milestones[i].double = false;
        }
    }
    return milestones;
}

function validate_milestones(milestones, ranges, are_doubles) {    
    let missing = [];
    let duplicated = [];
    let seen = [];
    
    for(const range of ranges) {
        for(let i=range[0];i<range[1];i++) {
            if(!milestones.find(e => e.distance == i)) {
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

    let out_of_range = milestones.map(d => d.distance).filter(distance => !is_number_in_ranges(distance, ranges));
    let single = milestones.filter(ml => are_doubles && !ml.double).map(ml=>ml.distance);
    

    return {missing, duplicated, out_of_range, single, milestones};
}

async function run() {
    const motorways = JSON.parse(fs.readFileSync('./data.json'));
    const final_data = [];
    for(let motorway of motorways) {
        let data = preprocess_osm_data(await fetch_milestones_for_motorway(motorway))
        .filter(marker => !Number.isNaN(marker.distance));
        motorway.milestones = data;
        merge_close_milestones(motorway.milestones);
        let possibly_invalid_milestones = validate_milestones(motorway.milestones, motorway.ranges);
        //let missing_milestones = find_missing_milestones(motorway.milestones/*.filter(ml => ml.double)*/.map(ml => ml.distance), motorway.ranges);
        console.log(motorway.name, "missing ", possibly_invalid_milestones.missing, "dupes", possibly_invalid_milestones.duplicated, "invalid", possibly_invalid_milestones.out_of_range, "single", possibly_invalid_milestones.single);
        final_data.push({
            name: motorway.name,
            ranges: motorway.ranges,
            warnings: possibly_invalid_milestones
        });
    }
    console.log(`Writing to output_data.json`);
    fs.writeFileSync(`output_data.json`, JSON.stringify(final_data));

}

run();