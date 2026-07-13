package com.example.Daylog.DTO;

import com.example.Daylog.Entity.UserEntity;
import lombok.*;

@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class UserDTO {
        private Long id;
        private String uid;
        private String password;
        private String name;
        private String age;
        private String gender;
        private String nickname;
        private String address;
        private String email;
        private String phone;
        private String profileURL;
        private String provider;
        private int likeCount;
        private java.time.LocalDateTime createdAt; // [B] edit by smsong - #2 가입일

        public static UserDTO entityToDto(UserEntity userEntity) {
                return new UserDTO(
                        userEntity.getId(),
                        userEntity.getUid(),
                        userEntity.getPassword(),
                        userEntity.getName(),
                        userEntity.getAge(),
                        userEntity.getGender(),
                        userEntity.getNickname(),
                        userEntity.getAddress(),
                        userEntity.getEmail(),
                        userEntity.getPhone(),
                        userEntity.getProfileURL(),
                        userEntity.getProvider(),
                        userEntity.getLikeCount(),
                        userEntity.getCreatedAt());
        }

        public UserEntity dtoToEntity() {
                return new UserEntity(id, uid, password, name, age, gender, nickname, address, email, phone, profileURL, provider, likeCount, createdAt);
        }
}