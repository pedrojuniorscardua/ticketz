import React from "react";

import MenuItem from "@material-ui/core/MenuItem";
import FormControl from "@material-ui/core/FormControl";
import Select from "@material-ui/core/Select";
import { Checkbox, ListItemText } from "@material-ui/core";

// Linhares: seletor compacto de filtro (mesmo visual do seletor de filas).
// Nada selecionado = sem filtro. Mostra a quantidade quando ha filtro ativo.
const TicketsFilterSelect = ({
  label,
  options = [],
  selectedIds = [],
  onChange,
  width = 120
}) => {
  const handleChange = e => {
    onChange(e.target.value);
  };

  return (
    <div style={{ width, marginTop: width === "100%" ? 0 : -4 }}>
      <FormControl fullWidth margin="dense">
        <Select
          multiple
          displayEmpty
          variant="outlined"
          value={selectedIds}
          onChange={handleChange}
          MenuProps={{
            anchorOrigin: {
              vertical: "bottom",
              horizontal: "left"
            },
            transformOrigin: {
              vertical: "top",
              horizontal: "left"
            },
            getContentAnchorEl: null
          }}
          renderValue={() =>
            selectedIds.length > 0 ? `${label} (${selectedIds.length})` : label
          }
        >
          {options.map(option => (
            <MenuItem dense key={option.id} value={option.id}>
              <Checkbox
                style={option.color ? { color: option.color } : undefined}
                size="small"
                color="primary"
                checked={selectedIds.indexOf(option.id) > -1}
              />
              <ListItemText primary={option.name} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </div>
  );
};

export default TicketsFilterSelect;
