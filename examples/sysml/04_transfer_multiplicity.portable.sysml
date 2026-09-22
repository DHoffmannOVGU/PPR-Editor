library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}

package <model_fastener_supply> 'Fastener Supply' {
    private import PPR::*;
    private import ScalarValues::*;

    item def <def_fastener> 'M6 Fastener' :> Product;
    part def <def_storage_rack> 'Storage Rack' :> Resource;
    part def <def_bin> 'Fastener Bin' :> Resource;

    part productOccurrences {
        item <use_supermarket_fasteners> 'Fasteners at Supermarket' : def_fastener;
        item <use_line_side_fasteners> 'Fasteners at Line Side' : def_fastener;
    }

    action processOccurrences {
    }

    part resourceOccurrences {
        part <use_storage_rack> 'Rack RK-01' : def_storage_rack {
            part <use_bin> 'Reusable Bin' : def_bin[2..8];
        }
    }

    flow <rel_transfer_fasteners> of def_fastener[1..*]
        from productOccurrences.use_supermarket_fasteners
        to productOccurrences.use_line_side_fasteners {
        attribute requestedQuantity : Real = 40;
    }
}
