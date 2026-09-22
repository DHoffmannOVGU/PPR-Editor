library package PPR {
    abstract item def Product;
    abstract action def Process;
    abstract part def Resource;
}

package <model_nested_assembly_cell> 'Nested Assembly Cell' {
    private import PPR::*;
    private import ScalarValues::*;

    item def <def_component> 'Component' :> Product;
    item def <def_positioned_component> 'Positioned Component' :> Product;
    item def <def_assembled_module> 'Assembled Module' :> Product;

    action def <def_assembly_cycle> 'Assembly Cycle' :> Process;
    action def <def_locate_component> 'Locate Component' :> Process;
    action def <def_fastening> 'Fastening' :> Process;

    part def <def_assembly_cell> 'Assembly Cell' :> Resource;
    part def <def_fixture> 'Locating Fixture' :> Resource;
    part def <def_screwdriver_robot> 'Screwdriver Robot' :> Resource;

    part productOccurrences {
        item <use_component> 'Component at Infeed' : def_component;
        item <use_positioned_component> 'Located Component' : def_positioned_component;
        item <use_assembled_module> 'Finished Module' : def_assembled_module;
    }

    action processOccurrences {
        action <use_assembly_cycle> 'Assemble One Module' : def_assembly_cycle {
            action <use_locate_component> 'Locate Component' : def_locate_component {
                in item component : def_component;
                out item positionedComponent : def_positioned_component;
            }
            action <use_fastening> 'Fasten Module' : def_fastening {
                in item positionedComponent : def_positioned_component;
                out item assembledModule : def_assembled_module;
            }
        }
        succession <rel_locate_before_fastening>
            first use_assembly_cycle.use_locate_component
            then use_assembly_cycle.use_fastening;
    }

    part resourceOccurrences {
        part <use_assembly_cell> 'Assembly Cell AC-01' : def_assembly_cell {
            part <use_fixture> 'Fixture FX-01' : def_fixture {
                perform processOccurrences.use_assembly_cycle.use_locate_component;
            }
            part <use_screwdriver_robot> 'Robot RB-01' : def_screwdriver_robot {
                perform processOccurrences.use_assembly_cycle.use_fastening;
            }
        }
    }

    flow <rel_component_input> from productOccurrences.use_component
        to processOccurrences.use_assembly_cycle.use_locate_component.component;
    flow <rel_positioned_output>
        from processOccurrences.use_assembly_cycle.use_locate_component.positionedComponent
        to productOccurrences.use_positioned_component;
    flow <rel_positioned_input> from productOccurrences.use_positioned_component
        to processOccurrences.use_assembly_cycle.use_fastening.positionedComponent;
    flow <rel_module_output>
        from processOccurrences.use_assembly_cycle.use_fastening.assembledModule
        to productOccurrences.use_assembled_module;

    allocation <rel_cell_supports_cycle>
        allocate processOccurrences.use_assembly_cycle
        to resourceOccurrences.use_assembly_cell;
}
