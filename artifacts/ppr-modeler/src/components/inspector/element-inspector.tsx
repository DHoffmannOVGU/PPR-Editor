import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { PprElement, ElementUpdate, Attribute } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, GripVertical } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

const STANDALONE_DEFINITION_VALUE = '__standalone__';

interface ElementInspectorProps {
  element: PprElement;
  definitions: PprElement[];
  onUpdate: (updates: ElementUpdate) => void;
  onDelete: () => void;
  deleteDisabled?: boolean;
  deleteHint?: string;
  deleteLabel?: string;
}

export function ElementInspector({
  element,
  definitions,
  onUpdate,
  onDelete,
  deleteDisabled = false,
  deleteHint,
  deleteLabel = 'Delete Element',
}: ElementInspectorProps) {
  const [name, setName] = useState(element.name);
  const [description, setDescription] = useState(element.description || '');
  const [definitionId, setDefinitionId] = useState(element.definition_id ?? '');
  const [attributes, setAttributes] = useState<Attribute[]>(element.attributes);
  const compatibleDefinitions = definitions.filter(
    definition => definition.type === element.type && definition.id !== element.id,
  );

  // Sync state when selection changes
  const initId = useRef(element.id);
  useEffect(() => {
    if (initId.current !== element.id) {
      initId.current = element.id;
      setName(element.name);
      setDescription(element.description || '');
      setDefinitionId(element.definition_id ?? '');
      setAttributes(element.attributes);
    }
  }, [element]);

  // Debounced auto-save for text fields
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  const saveChanges = useCallback((updates: ElementUpdate) => {
    onUpdate(updates);
  }, [onUpdate]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => saveChanges({ name: val }), 500);
  };

  const handleDescChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDescription(val);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => saveChanges({ description: val }), 500);
  };

  const handleDefinitionChange = (value: string) => {
    const nextDefinitionId = value === STANDALONE_DEFINITION_VALUE ? '' : value;
    setDefinitionId(nextDefinitionId);
    saveChanges({ definition_id: nextDefinitionId || null });
  };

  const handleAddAttribute = () => {
    const newAttr: Attribute = {
      id: crypto.randomUUID(),
      name: 'New Attribute',
      value: '',
      datatype: 'string',
      unit: ''
    };
    const newAttrs = [...attributes, newAttr];
    setAttributes(newAttrs);
    saveChanges({ attributes: newAttrs });
  };

  const handleUpdateAttribute = (id: string, field: keyof Attribute, value: string) => {
    const newAttrs = attributes.map(a => a.id === id ? { ...a, [field]: value } : a);
    setAttributes(newAttrs);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => saveChanges({ attributes: newAttrs }), 500);
  };

  const handleDeleteAttribute = (id: string) => {
    const newAttrs = attributes.filter(a => a.id !== id);
    setAttributes(newAttrs);
    saveChanges({ attributes: newAttrs });
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</Label>
              <Input 
                id="name" 
                value={name} 
                onChange={handleNameChange}
                className="font-medium rounded-sm border-border focus-visible:ring-1 focus-visible:ring-ring" 
              />
            </div>

            {element.kind === 'usage' && (
              <div className="space-y-1.5">
                  <Label htmlFor="definition" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                   Definition binding
                </Label>
                <Select
                  value={definitionId || STANDALONE_DEFINITION_VALUE}
                  onValueChange={handleDefinitionChange}
                >
                  <SelectTrigger id="definition" className="rounded-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STANDALONE_DEFINITION_VALUE}>
                      Standalone usage
                    </SelectItem>
                    {compatibleDefinitions.map(definition => (
                      <SelectItem key={definition.id} value={definition.id}>
                        {definition.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  {definitionId
                    ? 'This element is an instance of the selected reusable definition.'
                    : 'This usage is not assigned to a Library definition.'}
                </p>
              </div>
            )}
            
            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</Label>
              <Textarea 
                id="description" 
                value={description} 
                onChange={handleDescChange}
                className="min-h-[80px] text-sm rounded-sm resize-none"
              />
            </div>
          </div>

          <div className="h-px bg-border my-4" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Attributes</Label>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleAddAttribute}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="space-y-3">
              {attributes.map(attr => (
                <div key={attr.id} className="group relative bg-muted/30 border border-border p-2.5 rounded-sm space-y-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute -right-2 -top-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground rounded-full shadow-sm"
                    onClick={() => handleDeleteAttribute(attr.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Name</Label>
                      <Input 
                        value={attr.name} 
                        onChange={(e) => handleUpdateAttribute(attr.id, 'name', e.target.value)}
                        className="h-7 text-xs rounded-sm bg-background" 
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Value</Label>
                      <Input 
                        value={String(attr.value)}
                        onChange={(e) => handleUpdateAttribute(attr.id, 'value', e.target.value)}
                        className="h-7 text-xs rounded-sm bg-background font-mono" 
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Type</Label>
                      <Input 
                        value={attr.datatype || ''} 
                        onChange={(e) => handleUpdateAttribute(attr.id, 'datatype', e.target.value)}
                        className="h-7 text-xs rounded-sm bg-background" 
                        placeholder="e.g. string, float"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Unit</Label>
                      <Input 
                        value={attr.unit || ''} 
                        onChange={(e) => handleUpdateAttribute(attr.id, 'unit', e.target.value)}
                        className="h-7 text-xs rounded-sm bg-background" 
                        placeholder="e.g. kg, mm"
                      />
                    </div>
                  </div>
                </div>
              ))}
              {attributes.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-sm">
                  No attributes defined.
                </div>
              )}
            </div>
          </div>
          
        </div>
      </ScrollArea>
      
      <div className="p-4 border-t border-border shrink-0 bg-muted/10">
        <Button
          variant="destructive"
          size="sm"
          className="w-full rounded-sm gap-2"
          onClick={onDelete}
          disabled={deleteDisabled}
          title={deleteHint}
        >
          <Trash2 className="w-3.5 h-3.5" /> {deleteLabel}
        </Button>
      </div>
    </div>
  );
}
