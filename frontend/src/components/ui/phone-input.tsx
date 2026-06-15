/**
 * PhoneInput — wraps `react-phone-number-input` so it inherits our shadcn
 * Input look (height, ring, focus styles). E.164 output (e.g. `+593987654321`).
 *
 * Usage:
 *   <PhoneInput value={value} onChange={setValue} defaultCountry="EC" />
 *
 * The country selector shows the flag + dial code. By default we lock onto
 * EC because TYS is built for Ecuador first, but users can pick any country
 * from the dropdown.
 */
import * as React from "react";
import PhoneInputBase from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { cn } from "@/lib/utils";

const PhoneInput = React.forwardRef(function PhoneInput(
    { className, defaultCountry = "EC", "data-testid": testId, ...props },
    ref,
) {
    return (
        <PhoneInputBase
            ref={ref}
            international
            defaultCountry={defaultCountry}
            countryCallingCodeEditable={false}
            className={cn("tys-phone-input", className)}
            data-testid={testId}
            {...props}
        />
    );
});

export default PhoneInput;
