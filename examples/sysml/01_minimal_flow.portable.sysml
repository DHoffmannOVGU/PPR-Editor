library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}

package <model_minimal_pressing> 'Minimal Pressing' {
    private import PPR::*;
    private import ScalarValues::*;
    private import SI::*;

    item def <def_raw_blank> 'Raw Blank' :> Product {
        attribute <attr_thickness> 'thickness' : Real = 1.5 [mm];
    }
    item def <def_formed_blank> 'Formed Blank' :> Product;
    action def <def_form_blank> 'Form Blank' :> Process {
        attribute <attr_cycle_time> 'cycle time' : Real = 4 [s];
    }
    part def <def_press> 'Mechanical Press' :> Resource;

    part productOccurrences {
        item <use_raw_blank> 'Blank at Infeed' : def_raw_blank;
        item <use_formed_blank> 'Blank after Forming' : def_formed_blank;
    }

    action processOccurrences {
        action <use_form_blank> 'Form One Blank' : def_form_blank {
            in item blank : def_raw_blank;
            out item formedBlank : def_formed_blank;
        }
    }

    part resourceOccurrences {
        part <use_press> 'Press PR-01' : def_press {
            perform processOccurrences.use_form_blank;
        }
    }

    flow <rel_blank_input> from productOccurrences.use_raw_blank
        to processOccurrences.use_form_blank.blank;
    flow <rel_formed_output> from processOccurrences.use_form_blank.formedBlank
        to productOccurrences.use_formed_blank;
}
