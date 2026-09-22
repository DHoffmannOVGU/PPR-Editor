library package 'PPR Model Library' {
    abstract item def Product;
    abstract item products : Product[*] nonunique;
    abstract action def Process;
    abstract action processes : Process[*] nonunique;
    abstract part def Resource;
    abstract part resources : Resource[*] nonunique;
}

library package 'PPR Semantic Metadata' {
    private import 'PPR Model Library'::*;
    private import Metaobjects::SemanticMetadata;

    metadata def product :> SemanticMetadata {
        :>> baseType = products meta SysML::Usage;
    }
    metadata def process :> SemanticMetadata {
        :>> baseType = processes meta SysML::Usage;
    }
    metadata def resource :> SemanticMetadata {
        :>> baseType = resources meta SysML::Usage;
    }
}

package <model_powder_compaction> 'Powder Compaction' {
    private import 'PPR Semantic Metadata'::*;
    private import ScalarValues::*;
    private import SI::*;

    #product def <def_metal_powder> 'Metal Powder';
    #product def <def_green_compact> 'Green Compact';
    #process def <def_compact_powder> 'Compact Powder' {
        attribute <attr_cycle_time> 'cycle time' : Real = 3 [s];
    }
    #resource def <def_compaction_press> 'Compaction Press';

    part productOccurrences {
        #product item <use_metal_powder> 'Powder Charge' : def_metal_powder;
        #product item <use_green_compact> 'Pressed Compact' : def_green_compact;
    }

    action processOccurrences {
        #process action <use_compact_powder> 'Press Powder Charge' : def_compact_powder {
            in item powder : def_metal_powder;
            out item compact : def_green_compact;
        }
    }

    part resourceOccurrences {
        #resource part <use_compaction_press> 'Press CP-01' : def_compaction_press {
            perform processOccurrences.use_compact_powder;
        }
    }

    flow <rel_powder_input> from productOccurrences.use_metal_powder
        to processOccurrences.use_compact_powder.powder;
    flow <rel_compact_output> from processOccurrences.use_compact_powder.compact
        to productOccurrences.use_green_compact;
}
