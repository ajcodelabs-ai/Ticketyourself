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

type PhoneInputProps = Omit<
  React.ComponentPropsWithoutRef<typeof PhoneInputBase>,
  "onChange"
> & {
  onChange?: React.ComponentPropsWithoutRef<typeof PhoneInputBase>["onChange"];
};

const PhoneInput = React.forwardRef<
  React.ElementRef<typeof PhoneInputBase>,
  PhoneInputProps
>(function PhoneInput(props, ref) {
    const { className, defaultCountry = "EC", onChange, ...rest } = props
    return (
        <PhoneInputBase
            {...rest}
            onChange={onChange}
            ref={ref}
            international
            defaultCountry={defaultCountry}
            countryCallingCodeEditable={false}
            className={cn("tys-phone-input", className)}
        />
    );
});

export default PhoneInput;
