import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Searchable dropdown.
 *
 * Scrolling behaviour (Phase 7):
 *  - The popover content is height-capped and the inner CommandList scrolls
 *    independently of the page.
 *  - We stop wheel-event propagation when the cursor is inside the list so
 *    the host page does not scroll while the user is browsing options.
 *  - Keyboard navigation (Arrow keys / Enter / Escape) is provided by cmdk
 *    out of the box.
 */
export function SearchableSelect({
  options = [],
  value,
  onSelect,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  className,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  // Stop the wheel event from bubbling to the page when scrolling inside
  // the popover content. This is the root-cause fix for the page scrolling
  // while the user is trying to scroll the dropdown.
  const trapWheel = (e) => {
    e.stopPropagation();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
          data-testid="searchable-select-trigger"
        >
          <span className="truncate text-left">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        sideOffset={4}
        onWheel={trapWheel}
      >
        <Command shouldFilter={true}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList
            className="max-h-72 overflow-y-auto overscroll-contain"
            onWheel={trapWheel}
            data-testid="searchable-select-list"
          >
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onSelect(option.value);
                    setOpen(false);
                  }}
                  data-testid={`searchable-option-${option.value}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
