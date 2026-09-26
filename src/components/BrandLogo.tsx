import React from 'react';
import { Image, StyleProp, View, ViewStyle } from 'react-native';

type BrandLogoProps = {
  premium?: boolean;
  height?: number;
  width?: number;
  onDarkBackground?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Normalize the supplied exports' transparent margins without changing either file.
// The premium bounds include the original black PRO lettering above the s.
const LOGO_ARTWORK = {
  standard: {
    source: require('../../assets/logo.png'),
    width: 778,
    height: 321,
    bounds: { x: 77, y: 18, width: 625, height: 280 },
  },
  premium: {
    source: require('../../assets/logo_premium.png'),
    width: 1672,
    height: 941,
    bounds: { x: 84, y: 157, width: 1524, height: 672 },
  },
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  premium = false,
  height = 30,
  width = height * 3,
  onDarkBackground = false,
  style,
}) => {
  const artwork = premium ? LOGO_ARTWORK.premium : LOGO_ARTWORK.standard;
  const scale = Math.min(width / artwork.bounds.width, height / artwork.bounds.height);

  return (
    <View
      style={[
        { width, height, alignItems: 'center', justifyContent: 'center' },
        premium && onDarkBackground && { backgroundColor: '#FCFCFA', borderRadius: 4 },
        style,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={premium ? 'Bits Premium' : 'Bits'}
    >
      <View style={{ width: artwork.bounds.width * scale, height: artwork.bounds.height * scale, overflow: 'hidden' }}>
        <Image
          source={artwork.source}
          style={{
            position: 'absolute',
            width: artwork.width * scale,
            height: artwork.height * scale,
            left: -artwork.bounds.x * scale,
            top: -artwork.bounds.y * scale,
          }}
          resizeMode="contain"
          accessible={false}
        />
      </View>
    </View>
  );
};
