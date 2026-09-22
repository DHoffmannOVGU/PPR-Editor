library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}

package <model_parallel_inspection> 'Parallel Casting Inspection' {
    private import PPR::*;

    item def <def_casting> 'Machined Casting' :> Product;
    item def <def_dimensional_report> 'Dimensional Report' :> Product;
    item def <def_surface_report> 'Surface Report' :> Product;
    action def <def_dimensional_inspection> 'Dimensional Inspection' :> Process;
    action def <def_surface_inspection> 'Surface Inspection' :> Process;
    part def <def_cmm> 'Coordinate Measuring Machine' :> Resource;
    part def <def_vision_station> 'Vision Inspection Station' :> Resource;

    part productOccurrences {
        item <use_casting> 'Casting under Inspection' : def_casting;
        item <use_dimensional_report> 'Dimensional Result' : def_dimensional_report;
        item <use_surface_report> 'Surface Result' : def_surface_report;
    }

    action processOccurrences {
        action <use_dimensional_inspection> 'Measure Casting' : def_dimensional_inspection {
            in item casting : def_casting;
            out item report : def_dimensional_report;
        }
        action <use_surface_inspection> 'Inspect Casting Surface' : def_surface_inspection {
            in item casting : def_casting;
            out item report : def_surface_report;
        }
    }

    part resourceOccurrences {
        part <use_cmm> 'CMM CMM-01' : def_cmm {
            perform processOccurrences.use_dimensional_inspection;
        }
        part <use_vision_station> 'Vision Station VI-01' : def_vision_station {
            perform processOccurrences.use_surface_inspection;
        }
    }

    flow <rel_casting_to_dimensional> from productOccurrences.use_casting
        to processOccurrences.use_dimensional_inspection.casting;
    flow <rel_dimensional_report>
        from processOccurrences.use_dimensional_inspection.report
        to productOccurrences.use_dimensional_report;
    flow <rel_casting_to_surface> from productOccurrences.use_casting
        to processOccurrences.use_surface_inspection.casting;
    flow <rel_surface_report> from processOccurrences.use_surface_inspection.report
        to productOccurrences.use_surface_report;
}
