library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}

package <model_identity_properties> 'Identity and Properties' {
    private import PPR::*;
    private import ScalarValues::*;
    private import SI::*;

    item def <def_carrier_in> 'Carrier' :> Product {
        attribute <attr_material> 'material' : String = "Aluminium";
        attribute <attr_mass> 'mass' : Real = 2.4 [kg];
    }
    item def <def_carrier_out> 'Carrier' :> Product {
        attribute <attr_accepted> 'accepted' : Boolean = true;
        attribute <attr_hole_count> 'hole count' : Integer = 6;
    }
    action def <def_drill_carrier> 'Drill Carrier' :> Process;
    part def <def_drill_press> 'Operator\'s Drill Press' :> Resource;

    part productOccurrences {
        item <use_carrier_in> 'Carrier' : def_carrier_in;
        item <use_carrier_out> 'Carrier' : def_carrier_out;
    }

    action processOccurrences {
        action <use_drill_carrier> 'Drill Six Holes' : def_drill_carrier {
            in item carrierBefore : def_carrier_in;
            out item carrierAfter : def_carrier_out;
        }
    }

    part resourceOccurrences {
        part <use_drill_press> 'Drill Press DP-01' : def_drill_press {
            perform processOccurrences.use_drill_carrier;
        }
    }

    flow <rel_carrier_input> from productOccurrences.use_carrier_in
        to processOccurrences.use_drill_carrier.carrierBefore;
    flow <rel_carrier_output> from processOccurrences.use_drill_carrier.carrierAfter
        to productOccurrences.use_carrier_out;
}
