# Contextual Classes
Most classes (`formfactor-...`, `xr-...`) are self explanatory.

## VR Device Types
There are 3 levels of vr device. There is no class for the lack of vr, as these elements are expected to be disabled for other reasons (`xr-...` or `button-vr` class)

#### vr-device-last:
A phone always has vr available, but most users will not use it

menu: hide vr entrance in options

#### vr-device-enabled:
A device which has a vr headset available, such as a pc

menu: show vr entrance in all main menus

#### vr-device-first:
A device which is primarily a vr headset, like a meta quest or apple vision pro

menu: promote vr entrance as the user likely has no other viable controls
