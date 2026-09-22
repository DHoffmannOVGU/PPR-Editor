library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}

package <model_parts_washing> 'Parts Washing' {
    private import PPR::*;

    item def <def_soiled_part> 'Soiled Part' :> Product;
    item def <def_clean_part> 'Clean Part' :> Product;
    action def <def_wash_part> 'Wash Part' :> Process;
    part def <def_parts_washer> 'Parts Washer' :> Resource;
    part def <def_ventilation> 'Extraction Ventilation' :> Resource;

    part productOccurrences {
        item <use_soiled_part> 'Part before Washing' : def_soiled_part;
        item <use_clean_part> 'Part after Washing' : def_clean_part;
    }

    action processOccurrences {
        action <use_wash_part> 'Automatic Wash Cycle' : def_wash_part {
            in item soiledPart : def_soiled_part;
            out item cleanPart : def_clean_part;
        }
    }

    part resourceOccurrences {
        part <use_parts_washer> 'Washer WA-01' : def_parts_washer {
            perform processOccurrences.use_wash_part;
        }
        part <use_ventilation> 'Ventilation VE-01' : def_ventilation;
    }

    flow <rel_soiled_input> from productOccurrences.use_soiled_part
        to processOccurrences.use_wash_part.soiledPart;
    flow <rel_clean_output> from processOccurrences.use_wash_part.cleanPart
        to productOccurrences.use_clean_part;
    allocation <rel_ventilation_supports_wash>
        allocate processOccurrences.use_wash_part
        to resourceOccurrences.use_ventilation;
}
