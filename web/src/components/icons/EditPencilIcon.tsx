/**
 * Pencil-with-underline icon shown next to the "Enter custom value" /
 * "Type here to discuss more" input rows in confirm cards.
 * Inherits `currentColor` so the surrounding `text-*` token controls
 * tint (typically `text-text-tertiary` in the parent <span>).
 */
export function EditPencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.51502 0.586544C9.29548 -0.195096 10.5613 -0.195575 11.3424 0.585473L13.0326 2.27574C13.807 3.05012 13.8151 4.30377 13.0507 5.08804L11.9292 6.23869L7.39688 1.70638L8.51502 0.586544ZM6.33703 2.76784L10.8821 7.31296L5.55501 12.7786C4.99058 13.3577 4.21646 13.6843 3.40811 13.6843L1.49939 13.6842C0.646564 13.6841 -0.0345125 12.9732 0.00135428 12.1205L0.084283 10.1489C0.115882 9.39771 0.428105 8.68572 0.959173 8.15384L6.33703 2.76784ZM8.27521 13.6225C8.27521 14.0369 8.61087 14.3728 9.02493 14.3728H14.2212C14.6353 14.3728 14.9709 14.0369 14.9709 13.6225C14.9709 13.2082 14.6353 12.8723 14.2212 12.8723H9.02493C8.61087 12.8723 8.27521 13.2082 8.27521 13.6225Z"
        fill="currentColor"
      />
    </svg>
  );
}
