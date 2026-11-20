export function BusIllustration() {
  return (
    <svg
      className="bus-illustration"
      viewBox="0 0 680 380"
      role="img"
      aria-label="Illustration of a BUSTRA bus on a road in Mindoro"
    >
      <defs>
        <linearGradient id="busBody" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#dbe5ef" />
        </linearGradient>
        <linearGradient id="busGlass" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#20354d" />
          <stop offset="1" stopColor="#3b5871" />
        </linearGradient>
      </defs>
      <circle cx="417" cy="163" r="143" fill="#e5eef8" />
      <circle cx="550" cy="75" r="32" fill="#f6d790" />
      <path d="M20 272L155 153l90 91 77-74 136 102" fill="#ccdfdf" />
      <path d="M339 270l125-135 153 137" fill="#d9e8e2" />
      <path d="M58 269h586" stroke="#a9c2bc" strokeWidth="3" />
      <g fill="#6e9d8b">
        <path
          d="M86 266v-69m0 20c-35-25-44-5-13 8m14-10c29-26 43-8 11 9"
          stroke="#6e9d8b"
          strokeWidth="4"
          fill="none"
        />
        <path
          d="M599 270v-83m0 21c-40-24-44-1-11 10m12-13c32-32 49-10 12 5"
          stroke="#6e9d8b"
          strokeWidth="4"
          fill="none"
        />
      </g>
      <ellipse cx="352" cy="314" rx="259" ry="19" fill="#132c4a" opacity=".09" />
      <path
        d="M57 332h565m-484 20h67m225 0h93"
        stroke="#bac8d7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <g transform="translate(93 101)">
        <path
          d="M22 31Q23 9 52 8h353q33 0 42 29l23 104v53H5V66q0-25 17-35Z"
          fill="url(#busBody)"
          stroke="#b3c3d2"
          strokeWidth="2"
        />
        <path d="M34 29h251v89H17V61q0-25 17-32Z" fill="url(#busGlass)" />
        <path d="M300 29h88q25 0 32 23l16 66H300Z" fill="url(#busGlass)" />
        <path d="M399 32q22 0 28 28l14 58h19l-18-77q-5-13-19-13Z" fill="#1c314a" />
        <g stroke="#e4ecf3" strokeWidth="5">
          <path d="M81 29v89m58-89v89m58-89v89m58-89v89m83-89v89m44-89v89" />
        </g>
        <path d="M16 128h359l47 26h46v24h-58l-42-25H13Z" fill="#2563eb" />
        <path d="M13 156h353l43 27h59v10H5Z" fill="#0f2848" />
        <rect x="310" y="124" width="47" height="67" rx="3" fill="#c1d1de" stroke="#8b9fb2" />
        <path d="M334 124v67" stroke="#8b9fb2" />
        <path d="M314 129h16v40h-16m24-40h15v40h-15" fill="#354c65" />
        <circle cx="85" cy="193" r="29" fill="#192b3d" />
        <circle cx="85" cy="193" r="15" fill="#bccbd7" />
        <circle cx="85" cy="193" r="6" fill="#657d93" />
        <circle cx="387" cy="193" r="29" fill="#192b3d" />
        <circle cx="387" cy="193" r="15" fill="#bccbd7" />
        <circle cx="387" cy="193" r="6" fill="#657d93" />
        <path d="M447 145h19v12h-19" fill="#f0bf58" />
        <rect x="26" y="170" width="13" height="6" rx="2" fill="#f2b751" />
        <text
          x="153"
          y="147"
          fontFamily="Arial,sans-serif"
          fontSize="16"
          fontWeight="700"
          fill="white"
          letterSpacing="2"
        >
          BUSTRA
        </text>
        <path d="M425 41h28v31" stroke="#172e48" strokeWidth="5" fill="none" />
        <rect x="449" y="63" width="10" height="25" rx="4" fill="#20364c" />
      </g>
      <g transform="translate(479 32)">
        <path d="M0 19a21 21 0 1 1 42 0c0 17-21 35-21 35S0 36 0 19" fill="#2563eb" />
        <circle cx="21" cy="19" r="8" fill="white" />
      </g>
    </svg>
  )
}
