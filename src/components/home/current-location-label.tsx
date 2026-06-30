import React from "react";

type CurrentLocationLabelProps = {
  fallbackCity: string;
  className?: string;
};

export function CurrentLocationLabel({
  fallbackCity,
  className,
}: CurrentLocationLabelProps) {
  const classes = ["normal-case tracking-normal", className]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{fallbackCity}</span>;
}
